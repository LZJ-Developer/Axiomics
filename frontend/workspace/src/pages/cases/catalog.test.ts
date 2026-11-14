import { expect, test } from "bun:test"
import { cases, replay, select } from "./catalog"

test("publishes the approved demonstrations through project-independent replay routes", async () => {
  expect(cases.map((item) => item.id)).toEqual([
    "zheng-pbmc68k",
    "maynard-dlpfc",
    "snapatac2-hematopoiesis",
    "open2c-hesc-hff",
    "mcmicro-luad",
    "stamo-p22",
    "camus-merfish",
    "scenic-action",
  ])
  expect(new Set(cases.map((item) => item.segment.split("~", 1)[0])).size).toBe(8)
  // A replay plays an exported recording. It must not address a project or a
  // session, or a fresh tenant would have to be seeded with demo data before
  // the showcase could open.
  expect(cases.every((item) => replay(item) === `/cases/${item.id}`)).toBe(true)
  // The source ids stay in the catalog for the slice exporter.
  expect(cases.every((item) => item.segment && item.sessionID)).toBe(true)
  expect(cases.every((item) => item.frames > 0 && item.question && item.data && item.result)).toBe(true)
  expect(cases.every((item) => item.images.length === 3 && item.images.every((image) => image.startsWith("/cases/")))).toBe(
    true,
  )
  const assets = cases.flatMap((item) => item.images).map((image) => Bun.file(`${import.meta.dir}/../../../public${image}`).exists())
  expect((await Promise.all(assets)).every(Boolean)).toBe(true)
})

test("searches presentation copy and filters by omics category", () => {
  expect(select("PBMC", "all").map((item) => item.id)).toEqual(["zheng-pbmc68k", "snapatac2-hematopoiesis"])
  expect(select("59,911", "all").map((item) => item.id)).toEqual(["zheng-pbmc68k"])
  expect(select("灰质—白质", "all").map((item) => item.id)).toEqual(["maynard-dlpfc"])
  expect(select("22.7%", "all").map((item) => item.id)).toEqual(["maynard-dlpfc"])
  expect(select("GATA2", "all").map((item) => item.id)).toEqual(["snapatac2-hematopoiesis"])
  expect(select("2–10 Mb", "all").map((item) => item.id)).toEqual(["open2c-hesc-hff"])
  expect(select("15,509", "all").map((item) => item.id)).toEqual(["mcmicro-luad"])
  expect(select("", "单细胞转录组").map((item) => item.id)).toEqual(["zheng-pbmc68k", "scenic-action"])
  expect(select("", "单细胞表观组").map((item) => item.id)).toEqual(["snapatac2-hematopoiesis"])
  expect(select("", "三维基因组").map((item) => item.id)).toEqual(["open2c-hesc-hff"])
  expect(select("", "空间蛋白组").map((item) => item.id)).toEqual(["mcmicro-luad"])
  expect(select("PBMC", "空间转录组")).toEqual([])
})

test("finds the real RNA and H3K27ac application by tool, data and conclusion", () => {
  for (const term of ["STAMO", "9,370", "绝缘层"])
    expect(select(term, "all").map((item) => item.id)).toEqual(["stamo-p22"])
  expect(select("", "空间多组学").map((item) => item.id)).toEqual(["stamo-p22"])
})


test("finds the method-selection case by method and biological conclusion", () => {
  const item = cases.find((item) => item.id === "camus-merfish")
  expect(item?.tool).toBe("STAMapper + CAMUS")
  expect(item?.imageFit).toBe("contain")
  for (const term of ["STAMapper", "CAMUS", "室管膜", "31,340"])
    expect(select(term, "all").map((item) => item.id)).toEqual(["camus-merfish"])
  expect(select("CAMUS", "空间转录组").map((item) => item.id)).toEqual(["camus-merfish"])
})

 test("ST series filter preserves omics and combines with search", () => {
  expect(select("", "ST 系列").map((item) => item.id)).toEqual(["stamo-p22", "camus-merfish"])
  expect(select("CAMUS", "ST 系列").map((item) => item.id)).toEqual(["camus-merfish"])
  expect(select("ST 系列", "all").length).toBe(2)
  expect(select("PBMC", "ST 系列")).toEqual([])
})

test("finds the bounded analysis without claiming an automated review hook", () => {
  expect(select("GEXSCOPE", "all").map((item) => item.id)).toEqual(["scenic-action"])
  const item = cases.find((item) => item.id === "scenic-action")
  expect(item?.result).toContain("不可回答")
  expect(item?.result).toContain("独立审查")
  expect(item?.result).not.toContain("自动")
})
