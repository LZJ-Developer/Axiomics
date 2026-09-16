import { describe, expect, test } from "bun:test"
import { ManagedInstallPolicy } from "../../src/science/capability/install-policy"

describe("managed scientific installation policy", () => {
  test("redirects frozen omics stacks to the capability gateway", () => {
    expect(ManagedInstallPolicy.capability(["pip", "install", "scanpy==1.11.4"])).toBe("scanpy")
    expect(ManagedInstallPolicy.capability(["python", "-m", "pip", "install", "squidpy"])).toBe("squidpy")
    expect(ManagedInstallPolicy.capability(["pip", "install", "snapatac2==2.10.0"])).toBe("snapatac2")
    expect(ManagedInstallPolicy.capability(["micromamba", "create", "cooler", "cooltools"])).toBe("open2c")
    expect(ManagedInstallPolicy.capability(["Rscript", "-e", "remotes::install_github('GreenleafLab/ArchR')"])).toBe(
      "archr",
    )
    expect(ManagedInstallPolicy.capability(["git", "clone", "https://github.com/nf-core/mcmicro"])).toBe("mcmicro")
    expect(
      ManagedInstallPolicy.source(
        'subprocess.run([sys.executable, "-m", "pip", "install", "h5py", "anndata", "scanpy"])',
      ),
    ).toBe("scanpy")
  })

  test("leaves project-specific long-tail dependencies alone", () => {
    expect(ManagedInstallPolicy.capability(["pip", "install", "scikit-misc"])).toBeUndefined()
    expect(ManagedInstallPolicy.capability(["python", "analysis.py"])).toBeUndefined()
    expect(ManagedInstallPolicy.capability(["HiC-Pro", "-i", "reads", "-o", "results"])).toBeUndefined()
    expect(
      ManagedInstallPolicy.source('subprocess.run([sys.executable, "-m", "pip", "install", "scikit-misc"])'),
    ).toBeUndefined()
  })

  test("redirects direct execution from a managed toolchain root", () => {
    expect(
      ManagedInstallPolicy.execution([
        "/home/user/.axiomics/toolchains/omics-snapatac2-2.10.0/bin/python",
        "analysis.py",
      ]),
    ).toBe("snapatac2")
    expect(
      ManagedInstallPolicy.execution([
        "TC=/home/user/.axiomics/toolchains/omics-snapatac2-2.10.0; PY=$TC/bin/python; $PY analysis.py",
      ]),
    ).toBe("snapatac2")
    expect(ManagedInstallPolicy.execution(["python", "analysis.py"])).toBeUndefined()
    expect(ManagedInstallPolicy.execution(["cat", "/home/user/.axiomics/toolchains/registry.json"])).toBeUndefined()
  })
})
