import * as prompts from "@clack/prompts"
import { BILLING_URL } from "../../endpoints"
import { Axiomics } from "../../axiomics"
import { ACE_CONTRACT, aceActivationCopy } from "../../axiomics/ace-contract"
import { openUrl } from "../../util/open-url"
import { UI } from "../ui"
import { cmd } from "./cmd"

export const WalletCommand = cmd({
  command: ["wallet", "billing"],
  describe: "show your purchased Wallet balance and Ace model access",
  builder: (yargs) => yargs.command(ShowCommand).command(TopupCommand).demandCommand(),
  async handler() {},
})

const ShowCommand = cmd({
  command: ["show", "$0"],
  describe: "show purchased Wallet balance and model access",
  async handler() {
    UI.empty()
    prompts.intro("Axiomics Wallet")

    if (!(await Axiomics.getSession())) {
      prompts.log.warn("Not authenticated. Run `axiomics login` first.")
      prompts.outro("Done")
      return
    }

    const state = await Axiomics.getReconciledFundingState().catch(() => null)
    if (!state) {
      prompts.log.error(`The selected workspace is unavailable. Check your connection or visit ${BILLING_URL}`)
      prompts.outro("Done")
      return
    }
    const creditsRequest = Axiomics.getCredits(state.snapshot)
    const [mode, credits] = await Promise.all([Axiomics.getBillingMode(state.snapshot, creditsRequest), creditsRequest])
    prompts.log.info(credits ? `Purchased Wallet: $${credits.balanceUsd.toFixed(2)}` : "Purchased Wallet: unavailable")
    if (!mode) {
      prompts.log.error(`Model access is unavailable. Check your connection or visit ${BILLING_URL}`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`Model access: ${mode.mode === "managed" ? "Managed (Ace)" : "BYOK / Subscription"}`)
    if (!mode.managed_supported) {
      prompts.log.warn("Managed inference is not available for this account.")
    }
    if (mode.managed_supported && !mode.managed_unlocked) {
      prompts.log.info("Turn on Ace in Settings to use managed models.")
    }
    prompts.log.info(`Manage your purchased Wallet and Ace at ${BILLING_URL}`)
    prompts.outro("Done")
  },
})

const TopupCommand = cmd({
  command: "topup",
  describe: "open billing to add purchased Wallet credit",
  async handler() {
    UI.empty()
    prompts.intro("Axiomics Wallet")
    prompts.log.info(`Open: ${BILLING_URL}`)
    prompts.log.info(
      `$${ACE_CONTRACT.reloadAmountUsd} adds $${ACE_CONTRACT.reloadAmountUsd} to your purchased Wallet; the processing fee is shown separately at checkout.`,
    )
    prompts.log.info(aceActivationCopy())
    prompts.log.info("Provider accounts and local models never draw down your Wallet.")
    openUrl(BILLING_URL)
    prompts.outro("Done")
  },
})
