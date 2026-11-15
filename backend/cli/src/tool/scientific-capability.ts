import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { JobBroker } from "@/compute/job-broker"
import { BioNemoHosted, BioNemoInputs } from "@/science/bionemo"
import { CapabilityEvidence } from "@/science/capability/evidence"
import { CapabilityRegistry } from "@/science/capability/registry"
import { CapabilityRuntime } from "@/science/capability/runtime"
import { CapabilityWorkload } from "@/science/capability/schema"
import { validateCapabilitySmoke } from "@/science/capability/validation"
import { KernelEnvironmentMutation } from "@/science/kernel/environment-mutation"
import { SessionFilesystem } from "@/session/filesystem"
import { createComputeJobTool } from "./compute-job"
import { Tool } from "./tool"

const ACTIONS = [
  "list",
  "describe",
  "doctor",
  "setup",
  "plan",
  "start",
  "smoke",
  "status",
  "wait",
  "logs",
  "artifacts",
  "verify",
  "cancel",
  "retry_delivery",
  "release",
] as const
type Action = (typeof ACTIONS)[number]
const LIFECYCLE = new Set<Action>(["status", "wait", "logs", "artifacts", "cancel", "retry_delivery", "release"])

/** The project-scoped directories the platform already wires into every kernel
 * and Bash launch. Reported by doctor so an install's landing zone is an
 * observed path rather than something the caller has to infer (or invent) —
 * the same paths `pythonRuntime`/`rRuntime` export, read without provisioning
 * anything, so doctor stays cheap. */
async function writablePackages() {
  const targets = [
    {
      language: "python",
      path: path.join(KernelEnvironmentMutation.managedRoot("python", "python"), "site-packages"),
      mechanism: "PIP_TARGET + PYTHONPATH",
    },
    {
      language: "r",
      path: path.join(KernelEnvironmentMutation.managedRoot("r", "r"), "library"),
      mechanism: "R_LIBS_USER",
    },
  ]
  return Promise.all(
    targets.map(async (target) => {
      const entries = await fs.readdir(target.path).catch(() => [] as string[])
      const repository =
        target.language === "python"
          ? KernelEnvironmentMutation.pythonIndexUrl()
          : KernelEnvironmentMutation.cranMirror()
      return {
        ...target,
        scope: "project",
        ...(repository ? { repository } : {}),
        exists: await fs
          .access(target.path)
          .then(() => true)
          .catch(() => false),
        entries: entries.length,
      }
    }),
  )
}
const needsID = new Set<Action>(["describe", "doctor", "setup", "plan", "start", "smoke", "verify"])
const needsJob = new Set<Action>([...LIFECYCLE, "verify"])

export const ScientificCapabilityParameters = z
  .object({
    action: z.enum(ACTIONS),
    id: z.string().trim().min(1).optional(),
    name: CapabilityWorkload.shape.name.optional(),
    purpose: CapabilityWorkload.shape.purpose.optional(),
    command: CapabilityWorkload.shape.command.optional(),
    target: CapabilityWorkload.shape.target.optional(),
    cwd: CapabilityWorkload.shape.cwd,
    resources: CapabilityWorkload.shape.resources,
    artifacts: CapabilityWorkload.shape.artifacts,
    uploads: CapabilityWorkload.shape.uploads,
    payload: z.record(z.string(), z.unknown()).optional(),
    job_id: z.string().trim().min(1).optional(),
    seconds: z.number().int().min(1).max(3_600).optional(),
    bytes: z.number().int().min(1).max(256_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const alias = value.name ? CapabilityRegistry.describe(value.name) : undefined
    // doctor without an id is the catalog-wide check the prose names
    // ("list/doctor"): a caller that has not chosen a capability yet has no id
    // to send, and rejecting it costs a whole model step for nothing.
    if (needsID.has(value.action) && value.action !== "doctor" && !value.id && !alias)
      ctx.addIssue({ code: "custom", path: ["id"], message: `${value.action} requires a capability id` })
    if (needsJob.has(value.action) && !value.job_id)
      ctx.addIssue({ code: "custom", path: ["job_id"], message: `${value.action} requires a compute job id` })
    if (value.action === "smoke" && !value.target)
      ctx.addIssue({ code: "custom", path: ["target"], message: "smoke requires an explicit local or modal target" })
  })

type Metadata = {
  scientific_capability: {
    action: Action
    id?: string
    maturity?: "verified" | "experimental" | "blocked"
    dispatched: boolean
    stale_binding?: boolean
    verification?: unknown
  }
  compute_job?: unknown
  job?: unknown
}

const json = (value: unknown) => JSON.stringify(value, null, 2)
const next = (id: string) =>
  `Create the workload script under Project files/work, then call scientific_capability plan and start with id=${JSON.stringify(id)}, target="local", cwd="work", a command such as "python analysis.py", and declared artifacts. Axiomics stages that directory into Session scratch and injects the runtime; do not locate, activate, or invoke the managed runtime from Bash/Python/R.`
const sameBinding = (left: JobBroker.CapabilityBinding, right: JobBroker.CapabilityBinding) =>
  left.id === right.id &&
  left.version === right.version &&
  left.manifest_sha256 === right.manifest_sha256 &&
  left.profile === right.profile &&
  left.runtime_digest === right.runtime_digest

async function compute() {
  return createComputeJobTool().init()
}

async function manifest(id: string) {
  const item = CapabilityRegistry.describe(id)
  if (!item) throw new Error(`Unknown scientific capability: ${id}. Call scientific_capability list first.`)
  return item
}

function workload(args: z.infer<typeof ScientificCapabilityParameters>) {
  return CapabilityWorkload.parse({
    name: args.name,
    purpose: args.purpose,
    command: args.command,
    target: args.target,
    cwd: args.cwd,
    resources: args.resources,
    artifacts: args.artifacts,
    uploads: args.uploads,
  })
}

function computeMetadata(result: { metadata: Record<string, unknown> }) {
  return {
    ...(result.metadata.compute_job ? { compute_job: result.metadata.compute_job } : {}),
    ...(result.metadata.job ? { job: result.metadata.job } : {}),
  }
}

async function governedJob(input: { jobID: string; expectedID?: string; ctx: Tool.Context; requireCurrent?: boolean }) {
  const tool = await compute()
  const status = await tool.execute({ action: "status", job_id: input.jobID }, input.ctx)
  const metadata = status.metadata as Record<string, unknown>
  const envelope = metadata.compute_job as { job?: unknown } | undefined
  const job = JobBroker.Job.parse(envelope?.job)
  if (!job.capability) throw new Error(`Compute job ${job.id} was not created by scientific_capability`)
  if (input.expectedID && job.capability.id !== input.expectedID)
    throw new Error(`Compute job ${job.id} belongs to ${job.capability.id}, not ${input.expectedID}`)
  const item = CapabilityRegistry.describe(job.capability.id)
  const expected = item?.runtime
    ? CapabilityRegistry.binding({ manifest: item, profile: job.capability.profile })
    : undefined
  const stale = !item?.runtime || !expected || !sameBinding(job.capability, expected)
  if (input.requireCurrent) {
    if (!item)
      throw new Error(`Unknown scientific capability: ${job.capability.id}. Call scientific_capability list first.`)
    if (!item.runtime) throw new Error(`${item.name} no longer exposes a governed runtime`)
    if (stale) {
      throw new Error(
        `Compute job ${job.id} is bound to a stale ${item.name} manifest and cannot be operated as current evidence`,
      )
    }
  }
  return {
    item,
    job,
    expected: expected ?? job.capability,
    status,
    stale_binding: stale,
    id: job.capability.id,
    name: item?.name ?? job.capability.id,
    maturity: item?.maturity,
  }
}

async function lifecycle(args: z.infer<typeof ScientificCapabilityParameters>, ctx: Tool.Context) {
  const checked = await governedJob({ jobID: args.job_id!, expectedID: args.id, ctx, requireCurrent: false })
  if (args.action === "status") return { result: checked.status, checked }
  const tool = await compute()
  const result = await tool.execute(
    args.action === "wait"
      ? { action: "wait", job_id: args.job_id!, seconds: args.seconds ?? 600 }
      : args.action === "logs"
        ? { action: "logs", job_id: args.job_id!, bytes: args.bytes ?? 64_000 }
        : args.action === "artifacts"
          ? { action: "artifacts", job_id: args.job_id! }
          : args.action === "cancel"
            ? { action: "cancel", job_id: args.job_id! }
            : args.action === "retry_delivery"
              ? { action: "retry_delivery", job_id: args.job_id! }
              : { action: "release", job_id: args.job_id! },
    ctx,
  )
  return { result, checked }
}

export const ScientificCapabilityTool = Tool.define<typeof ScientificCapabilityParameters, Metadata>(
  "scientific_capability",
  {
    description: [
      "One governed gateway for the versioned scientific capability catalog.",
      "For a multi-step analysis in scRNA, spatial transcriptomics, scATAC, Hi-C, or imaging/spatial proteomics, call this before the first environment probe. A single plot, statistic, or conversion on a supplied table does not need the catalog — run it in the ready runtime. The default mappings are scanpy, squidpy, snapatac2, open2c, and mcmicro; choose ArchR only when the task specifically needs it.",
      "Use list or doctor for the catalog-wide state; describe and doctor with an id add runtime integrity and hosted checks. Do this before setup or spend. For catalog-managed omics tools, use start instead of installing or activating an environment in Bash: the platform injects the registered runtime. plan never dispatches. setup may create an exact pinned Python pack; managed toolchains are provisioned only by infrastructure and setup merely verifies them. start dispatches a packaged workload or sends a strict BYOK NVIDIA NIM request. smoke dispatches a bounded canonical local/Modal check, and verify validates its captured artifacts before recording evidence.",
      "describe includes the hosted request_schema. Build payload from that schema, then plan validates all cross-field requirements without sending data or spending credits.",
      "doctor reports writable_packages: the project-scoped Python site-packages and R library the platform already exports as PIP_TARGET/PYTHONPATH and R_LIBS_USER. When the catalog has no tool for a long-tail need, install into them with a plain `pip install <package>` (or `install.packages`) in Bash — do not invent a directory, and do not pass --target or set PYTHONPATH yourself; the next command and kernel import it without extra wiring.",
      "status/wait/logs/artifacts/cancel/retry_delivery/release accept only jobs created by scientific_capability and may report stale_binding when the catalog changed. Callers cannot override pinned packages, images, GPU, or secrets.",
    ].join(" "),
    parameters: ScientificCapabilityParameters,
    normalizeInput(input) {
      const value =
        input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
      if (
        LIFECYCLE.has(value.action as Action) &&
        !value.job_id &&
        typeof value.id === "string" &&
        /^[a-f0-9]{8}-[a-z0-9]+$/i.test(value.id)
      ) {
        return { ...value, id: undefined, job_id: value.id }
      }
      if (value.action !== "plan" && value.action !== "start") return input
      const name = typeof value.name === "string" ? value.name : typeof value.id === "string" ? value.id : undefined
      return {
        ...value,
        name,
        purpose:
          typeof value.purpose === "string" && value.purpose.trim()
            ? value.purpose
            : `Run the ${name ?? "scientific"} workflow for the current research request.`,
        target: value.target ?? "local",
      }
    },
    async execute(args, ctx) {
      if (args.action === "list") {
        const capabilities = await Promise.all(
          CapabilityRegistry.listDetailed().map(async (item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            maturity: item.maturity,
            availability: await CapabilityRuntime.availability(item, { verification: "status" }),
          })),
        )
        return {
          title: "Scientific capabilities",
          output: json({
            capabilities,
            ready_local: capabilities
              .filter((item) => item.availability.local === "ready" || item.availability.local === "configured")
              .map((item) => item.id),
            next: "For a matching ready/configured capability, call doctor with its id, write the workload entry point in the project, then call plan/start with target=local. Do not inspect registries, source code, or runtime paths; the platform injects the runtime.",
            maturity_meaning: {
              verified: "A release-artifact lifecycle canary has passed on every advertised ready backend.",
              experimental:
                "A productized contract exists, but the release evidence is incomplete or backend-specific.",
              blocked: "The capability cannot run until the declared blocker is resolved.",
            },
          }),
          metadata: { scientific_capability: { action: args.action, dispatched: false } },
        }
      }

      if (LIFECYCLE.has(args.action)) {
        const { result, checked } = await lifecycle(args, ctx)
        return {
          title: `Capability ${args.action}: ${checked.name}`,
          output: result.output,
          attachments: result.attachments,
          metadata: {
            scientific_capability: {
              action: args.action,
              id: checked.id,
              maturity: checked.maturity,
              dispatched: args.action === "cancel" || args.action === "retry_delivery" || args.action === "release",
              stale_binding: checked.stale_binding,
            },
            ...computeMetadata(result),
          },
        }
      }

      // Catalog-wide doctor: the answer to "is anything ready, and where do
      // packages go" before a capability has been chosen. Per-capability
      // integrity checks stay behind an id.
      if (args.action === "doctor" && !args.id && !args.name) {
        const capabilities = await Promise.all(
          CapabilityRegistry.listDetailed().map(async (item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            maturity: item.maturity,
            availability: await CapabilityRuntime.availability(item, { verification: "status" }),
          })),
        )
        return {
          title: "Scientific capability doctor",
          output: json({
            capabilities,
            writable_packages: await writablePackages(),
            next: "Call doctor with a capability id for runtime integrity and hosted checks, then plan/start with target=local.",
          }),
          metadata: { scientific_capability: { action: args.action, dispatched: false } },
        }
      }

      const item = await manifest(args.id ?? args.name!)
      const base = { action: args.action, id: item.id, maturity: item.maturity, dispatched: false } as const

      if (args.action === "describe")
        return {
          title: `Capability: ${item.name}`,
          output: json({
            ...item,
            ...(item.runtime?.kind === "managed_toolchain"
              ? {
                  runtime: {
                    kind: item.runtime.kind,
                    targets: item.runtime.targets,
                    local_platforms: item.runtime.local_platforms,
                    components: item.runtime.components,
                    resources: item.runtime.resources,
                    network: item.runtime.network,
                  },
                }
              : {}),
            ...(item.hosted
              ? { request_schema: z.toJSONSchema(BioNemoInputs[item.hosted.adapter_id], { io: "input" }) }
              : {}),
          }),
          metadata: { scientific_capability: base },
        }

      if (args.action === "doctor") {
        const runtime = await CapabilityRuntime.doctor(item)
        const hosted = item.hosted ? await BioNemoHosted.doctor(item.hosted.adapter_id) : undefined
        return {
          title: `Capability doctor: ${item.name}`,
          output: json({
            ...runtime,
            local: {
              state: runtime.local.state,
              platform: runtime.local.platform,
              environment: runtime.local.environment,
              lock_sha256: runtime.local.lock_sha256,
              integrity: runtime.local.integrity,
              writable_packages: await writablePackages(),
            },
            ...(item.runtime?.kind === "managed_toolchain" ? { next: next(item.id) } : {}),
            ...(hosted ? { hosted } : {}),
          }),
          metadata: { scientific_capability: base },
        }
      }

      if (args.action === "setup") {
        if (!item.runtime?.targets.includes("local")) {
          return {
            title: `Capability setup: ${item.name}`,
            output: json({
              capability: item.id,
              state: item.maturity === "blocked" ? "blocked" : "setup_needed",
              setup: item.setup ?? null,
              blocker: item.blocker ?? null,
              dispatched: false,
            }),
            metadata: { scientific_capability: base },
          }
        }
        if (item.runtime.kind === "managed_toolchain") {
          const result = await CapabilityRuntime.setup(item)
          return {
            title: `Capability setup: ${item.name}`,
            output: json({
              capability: result.capability,
              state: result.state,
              environment: result.environment,
              components: result.components,
              lock_digest: result.lock_digest,
              next: next(item.id),
            }),
            metadata: { scientific_capability: base },
          }
        }
        await ctx.ask({
          permission: "environment_mutation",
          patterns: [item.runtime.lock_digest],
          always: [item.runtime.lock_digest],
          metadata: {
            environment_mutation: {
              language: "python",
              environment: item.runtime.pack_id,
              operation: "install exact scientific capability pack",
              manager: "micromamba+pip",
              plan_digest: item.runtime.lock_digest,
              restart: false,
              warning: "This downloads and installs the exact package graph declared by the capability manifest.",
            },
          },
        })
        const result = await CapabilityRuntime.setup(item)
        return {
          title: `Capability setup: ${item.name}`,
          output: json(result),
          metadata: { scientific_capability: { ...base, dispatched: true } },
        }
      }

      if (args.action === "plan") {
        if (item.maturity === "blocked") {
          return {
            title: `Capability blocked: ${item.name}`,
            output: json({ capability: item.id, maturity: item.maturity, blocker: item.blocker, dispatched: false }),
            metadata: { scientific_capability: base },
          }
        }
        if (item.hosted) {
          if (!args.payload)
            throw new Error(`${item.name} requires a payload matching its strict hosted request schema`)
          const result = await BioNemoHosted.plan(item.hosted.adapter_id, args.payload)
          return {
            title: `Capability plan: ${item.name}`,
            output: json(result),
            metadata: { scientific_capability: base },
          }
        }
        if (!item.runtime) {
          return {
            title: `Capability setup plan: ${item.name}`,
            output: json({
              capability: item.id,
              executable: false,
              setup: item.setup ?? null,
              blocker: item.blocker ?? null,
              dispatched: false,
            }),
            metadata: { scientific_capability: base },
          }
        }
        const result = await CapabilityRegistry.compileTask(item.id, workload(args))
        const { execution: _execution, ...publicResult } = result
        return {
          title: `Capability plan: ${item.name}`,
          output: json({ ...publicResult, next: "Review this exact plan, then call start with the same workload." }),
          metadata: { scientific_capability: base },
        }
      }

      if (args.action === "start") {
        if (item.maturity === "blocked") throw new Error(item.blocker ?? `${item.name} is blocked`)
        if (item.hosted) {
          if (!args.payload)
            throw new Error(`${item.name} requires a payload matching its strict hosted request schema`)
          const preview = await BioNemoHosted.plan(item.hosted.adapter_id, args.payload)
          await ctx.ask({
            permission: "remote_compute",
            patterns: [preview.approval_sha256],
            always: [],
            metadata: {
              scientific_capability: {
                id: item.id,
                capability: item.name,
                provider: preview.provider,
                endpoint: preview.endpoint,
                status_endpoint_template: preview.status_endpoint_template,
                status_host: preview.status_host,
                request_sha256: preview.request_sha256,
                approval_sha256: preview.approval_sha256,
                api_schema_version: preview.api_schema_version,
                payload_bytes: preview.payload_bytes,
                egress_summary: preview.egress_summary,
                terms_url: preview.terms_url,
                method: preview.method,
                warning: preview.warning,
                dispatched: false,
              },
            },
          })
          const result = await BioNemoHosted.start(item.hosted.adapter_id, ctx.sessionID, args.payload)
          return {
            title: `Capability run: ${item.name}`,
            output: json(result),
            metadata: { scientific_capability: { ...base, dispatched: true } },
          }
        }
        if (!item.runtime) throw new Error(item.setup?.instructions ?? `${item.name} has no release-packaged executor`)
        const proposal = await CapabilityRegistry.compileTask(item.id, workload(args))
        const { action: _action, ...input } = proposal.input
        const tool = await compute()
        const result = await tool.execute(
          { action: "start", ...input },
          {
            ...ctx,
            extra: {
              ...ctx.extra,
              scientificCapability: proposal.binding,
              scientificCapabilityExecution: proposal.execution,
            },
          },
        )
        return {
          title: `Capability run: ${item.name}`,
          output: result.output,
          attachments: result.attachments,
          metadata: { scientific_capability: { ...base, dispatched: true }, ...computeMetadata(result) },
        }
      }

      if (args.action === "smoke") {
        if (!item.runtime)
          throw new Error(item.blocker ?? item.setup?.instructions ?? `${item.name} has no bounded smoke`)
        const relative = path.join(
          "scientific-capabilities",
          item.id,
          `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        )
        await fs.mkdir(path.join(await SessionFilesystem.workspace(ctx.sessionID), relative), {
          recursive: true,
          mode: 0o700,
        })
        const proposal = await CapabilityRegistry.compileSmoke(item.id, args.target!, relative)
        const { action: _action, ...input } = proposal.input
        const tool = await compute()
        const result = await tool.execute(
          { action: "start", ...input },
          {
            ...ctx,
            extra: {
              ...ctx.extra,
              scientificCapability: proposal.binding,
              scientificCapabilityExecution: proposal.execution,
            },
          },
        )
        return {
          title: `Capability smoke: ${item.name}`,
          output: result.output,
          attachments: result.attachments,
          metadata: { scientific_capability: { ...base, dispatched: true }, ...computeMetadata(result) },
        }
      }

      const checked = await governedJob({ jobID: args.job_id!, expectedID: item.id, ctx, requireCurrent: true })
      if (checked.expected.profile !== "smoke")
        throw new Error(`Compute job ${checked.job.id} is a task, not a bounded smoke`)
      const validation = await validateCapabilitySmoke({
        manifest: item,
        job: checked.job,
        sessionID: ctx.sessionID,
        expectedBinding: checked.expected,
      })
      const evidence = await CapabilityEvidence.record({
        binding: checked.expected,
        target: validation.target,
        job_id: checked.job.id,
        metrics: validation.metrics,
        artifacts: validation.artifacts,
      })
      return {
        title: `Capability verified: ${item.name}`,
        output: json({ validation, evidence, maturity_unchanged: item.maturity }),
        metadata: { scientific_capability: { ...base, verification: evidence } },
      }
    },
  },
)
