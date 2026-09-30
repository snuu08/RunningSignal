import { describe, expect, it } from "vitest";
import { xlsxToObjects } from "./xlsx.ts";
import { classifyCollected } from "./collect.ts";
import { auditMapCatalog } from "./catalog-audit.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

// Minimal stored ZIP entries for the local-entry XLSX reader; no formula execution.
function workbook(files: Record<string, string>): Uint8Array {
  return Buffer.concat(Object.entries(files).flatMap(([path, xml]) => {
    const name = Buffer.from(path);
    const content = Buffer.from(xml);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    return [header, name, content];
  }));
}

const sourceWorkbook = () => workbook({
  "xl/workbook.xml": '<workbook><sheets><sheet name="횡단보도" r:id="rId1"/><sheet name="보행등" r:id="rId2"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/crossings.xml"/><Relationship Id="rId2" Target="/xl/worksheets/lights.xml"/></Relationships>',
  "xl/worksheets/crossings.xml": '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>서울 위치 자료</t></is></c></row><row r="4"><c r="B4" t="inlineStr"><is><t>관리번호</t></is></c><c r="C4" t="inlineStr"><is><t>교차로명</t></is></c></row><row r="5"><c r="B5" t="inlineStr"><is><t>06-0000007557</t></is></c><c r="C5" t="inlineStr"><is><t>국기원입구</t></is></c></row></sheetData></worksheet>',
  "xl/worksheets/lights.xml": '<worksheet><sheetData><row r="4"><c r="A4" t="inlineStr"><is><t>보행등관리번호</t></is></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>0000123</t></is></c></row></sheetData></worksheet>',
});

describe("source XLSX intake", () => {
  it("selects the named worksheet and skips the three preamble rows", () => {
    const result = xlsxToObjects(sourceWorkbook(), { sheet: "횡단보도", headerRow: 4 });
    expect(result.sheetName).toBe("횡단보도");
    expect(result.headers).toEqual(["col_1", "관리번호", "교차로명"]);
    expect(result.rows).toEqual([{ col_1: "", 관리번호: "06-0000007557", 교차로명: "국기원입구" }]);
    const lights = xlsxToObjects(sourceWorkbook(), { sheet: "보행등", headerRow: 4 });
    expect(lights.rows).toEqual([{ 보행등관리번호: "0000123" }]);
  });
  it("refuses a blank header, missing sheet and invalid header row", () => {
    expect(() => xlsxToObjects(sourceWorkbook())).toThrow("xlsx_header_row_empty");
    expect(() => xlsxToObjects(sourceWorkbook(), { sheet: "unknown" })).toThrow("xlsx_sheet_not_found");
    for (const headerRow of [0, -1, 1.5, NaN]) {
      expect(() => xlsxToObjects(sourceWorkbook(), { headerRow })).toThrow("xlsx_header_row_invalid");
    }
  });
  it("retains first-row conversion for ordinary workbooks", () => {
    const result = xlsxToObjects(workbook({ "xl/worksheets/sheet1.xml": '<worksheet><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="A2" t="inlineStr"><is><t>0007</t></is></c></worksheet>' }));
    expect(result.rows).toEqual([{ id: "0007" }]);
  });
});

describe("UTIC authentication diagnostics", () => {
  it.each([
    ['[{"resultCode":"32","resultMsg":"unregistered IP"}]', "application/json"],
    ['{"response":{"header":{"resultCode":32}}}', "application/json"],
    ['<?xml version="1.0"?><response><header><resultCode>32</resultCode></header></response>', "application/xml"],
    ['<r:response><r:resultCode><![CDATA[32]]></r:resultCode></r:response>', "text/xml"],
  ])("reports IP registration separately from missing Seoul records: %s", (body, type) => {
    const result = classifyCollected(200, type, bytes(body));
    expect(result.kind).toBe("auth");
    expect(result.providerResultCode).toBe("32");
    expect(result.requiredAction).toBe("register_requesting_public_ip");
    expect(result.regionMissing).toBe(false);
  });
  it("keeps the provider code on HTTP authentication failures", () => {
    expect(classifyCollected(403, "application/json", bytes('{"resultCode":"32"}')).providerResultCode).toBe("32");
  });
  it("does not treat a successful XML response as an auth error", () => {
    expect(classifyCollected(200, "text/xml", bytes('<response><resultCode>0</resultCode></response>')).kind).toBe("xml");
  });
});

describe("MAP source coverage", () => {
  const centers = bytes('itstId,itstNm,mapCtptIntLat,mapCtptIntLot\n2207,국기원입구,37.4990121,127.0310323\n22207,국기원입구(연등),37.4996489,127.0331074');
  it("keeps absent records distinct from unsupplied files and does not join names", () => {
    const result = auditMapCatalog({ centers, lanes: bytes("itstId,laneId,laneTypeCd\n1,1,0") }, ["2207", "22207"]);
    expect(result.targets.map((t) => t.rows)).toEqual([
      { centers: 1, lanes: 0, nodes: null, connections: null },
      { centers: 1, lanes: 0, nodes: null, connections: null },
    ]);
    expect(result.idsPresentInAllFourFiles).toBeNull();
    expect(result.predictionReady).toBe(false);
  });
  it("refuses an HTML error page disguised as a CSV", () => {
    expect(() => auditMapCatalog({ centers: bytes("<html>login</html>") })).toThrow("catalog_columns_missing");
  });
  it("does not promote file presence to verified crossing data", () => {
    const result = auditMapCatalog({
      centers,
      lanes: bytes("itstId,laneId,laneTypeCd\n2207,1,3"),
      nodes: bytes("itstId,laneId,nodeOrdr,ofstXaxsCrdnt,ofstYaxsCrdnt\n2207,1,1,-984,178"),
      connections: bytes("itstId,laneId,laneCnncId,signlgroupCd\n2207,1,2,40"),
    }, ["2207"]);
    expect(result.idsPresentInAllFourFiles).toEqual(["2207"]);
    expect(result.targets[0].presentInAllFourFiles).toBe(true);
    expect(result.stage).toBe("raw");
    expect(result.predictionReady).toBe(false);
  });
});
