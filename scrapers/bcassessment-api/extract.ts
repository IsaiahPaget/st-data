import { mkdir, writeFile } from "node:fs/promises";

const MAPSEARCH_URL = "https://www.bcassessment.ca/Property/Mapsearch?sp=1";
const REFERER = "https://www.bcassessment.ca/";
const QUERY_BASE =
    "https://arcgis.bcassessment.ca/ext_wa/rest/services/DCX/AFP_20260414/MapServer/0/query";

const OUT_FIELDS =
    "AFP_OID,UNIT_NUMBER,TOTAL_ASSESSED,ROLL,AREA_EVBC,JUR,TOTAL_LAND,TOTAL_BUILDING,ADDRESS,DESCRIPTION,STREET_NUMBER,STREET_NAME,OID_EVBC,SHORT_ADDRESS,IS_STRATA,FARM_FLAG,UTILITY_FLAG,MAJ_INDUSTRY_FLAG,MANAGED_FOREST_FLAG";

const PAGE_SIZE = 1000;

const WHERE = "ADDRESS LIKE '%KELOWNA%' AND ADDRESS NOT LIKE '%WEST KELOWNA%'";
const CONCURRENCY = 5;
const DIST_DIR = "dist";

type Feature = { attributes: Record<string, unknown> };
type QueryResponse = {
    error?: { code: number; message: string };
    features?: Feature[];
};

async function getToken() {
    const res = await fetch(MAPSEARCH_URL);
    if (!res.ok) throw new Error(`Mapsearch request failed: ${res.status}`);
    const html = await res.text();
    const match = html.match(/var gistoken = '([^']+)'/);
    if (!match) throw new Error("Could not find gistoken in Mapsearch page");
    const token = match[1];
    if (!token) throw new Error("Empty gistoken in Mapsearch page");
    return token;
}

async function queryPage(token: string, offset: number) {
    const params = new URLSearchParams({
        token,
        f: "json",
        where: WHERE,
        returnGeometry: "false",
        outFields: OUT_FIELDS,
        orderByFields: "AFP_OID",
        resultRecordCount: String(PAGE_SIZE),
        resultOffset: String(offset),
    });

    const res = await fetch(`${QUERY_BASE}?${params}`, {
        headers: { Referer: REFERER },
    });
    if (!res.ok) throw new Error(`Query request failed: ${res.status}`);
    const data = (await res.json()) as QueryResponse;
    if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
    return data.features ?? [];
}

async function main() {
    const token = await getToken();

    const all: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE * CONCURRENCY) {
        const pages = await Promise.all(
            Array.from({ length: CONCURRENCY }, (_, page) =>
                queryPage(token, offset + page * PAGE_SIZE),
            ),
        );
        for (const page of pages) all.push(...page.map((f) => f.attributes));
        console.error(`fetched ${all.length}`);
        if (pages.some((page) => page.length < PAGE_SIZE)) break;
    }

    await mkdir(DIST_DIR, { recursive: true });
    await writeFile(`${DIST_DIR}/kelowna.json`, JSON.stringify(all, null, 2));
    console.error(`wrote ${all.length} records to kelowna.json`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
