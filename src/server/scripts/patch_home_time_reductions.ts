import * as fs from 'fs';
import * as path from 'path';
import { ensureBackup, parseSwz, writeSwz } from './swzPatchUtils';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const RANK_UPGRADE_TIMES_SECONDS: Record<number, number> = {
    1: 30 * 60,
    2: 1 * 60 * 60,
    3: 16 * 60 * 60,
    4: 24 * 60 * 60,
    5: 32 * 60 * 60,
    6: 40 * 60 * 60,
    7: 48 * 60 * 60,
    8: 56 * 60 * 60,
    9: 64 * 60 * 60,
    10: 72 * 60 * 60
};
const DATA_FILES = [
    {
        label: 'BuildingTypes',
        xmlPath: path.join(ROOT, 'src', 'client', 'content', 'xml', 'BuildingTypes.xml'),
        jsonPath: path.join(ROOT, 'src', 'server', 'data', 'BuildingTypes.json'),
        prettyJson: true
    },
    {
        label: 'AbilityTypes',
        xmlPath: path.join(ROOT, 'src', 'client', 'content', 'xml', 'AbilityTypes.xml'),
        jsonPath: path.join(ROOT, 'src', 'server', 'data', 'AbilityTypes.json'),
        prettyJson: false
    }
];
const GAME_SWZ_FILES = ['Game.swz', 'Game.en.swz', 'Game.tr.swz'].map((fileName) =>
    path.join(ROOT, 'src', 'client', 'content', 'localhost', 'p', 'cbq', fileName)
);

function getRankUpgradeTime(rank: unknown): string | null {
    const normalizedRank = Math.max(0, Math.round(Number(rank ?? 0)));
    const seconds = RANK_UPGRADE_TIMES_SECONDS[normalizedRank];
    return seconds === undefined ? null : String(seconds);
}

function patchXmlUpgradeTimes(xml: string): { xml: string; changes: number } {
    let changes = 0;
    const nextXml = xml.replace(/<(Building|Ability)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, (block: string) => {
        const rank = block.match(/<Rank>(\d+)<\/Rank>/)?.[1];
        const upgradeTime = getRankUpgradeTime(rank);
        if (upgradeTime === null) {
            return block;
        }

        return block.replace(/<UpgradeTime>(\d+)<\/UpgradeTime>/, (match, value: string) => {
            if (value === upgradeTime) {
                return match;
            }
            changes += 1;
            return `<UpgradeTime>${upgradeTime}</UpgradeTime>`;
        });
    });
    return { xml: nextXml, changes };
}

function verifyXmlUpgradeTimes(xml: string, label: string): void {
    for (const blockMatch of xml.matchAll(/<(Building|Ability)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g)) {
        const block = blockMatch[0];
        const rank = block.match(/<Rank>(\d+)<\/Rank>/)?.[1];
        const expected = getRankUpgradeTime(rank);
        if (expected === null) {
            continue;
        }

        const actual = block.match(/<UpgradeTime>(\d+)<\/UpgradeTime>/)?.[1] ?? '';
        if (actual !== expected) {
            throw new Error(`${label} rank ${rank} keeps UpgradeTime ${actual}, expected ${expected}`);
        }
    }
}

function patchLooseXml(filePath: string, verify: boolean): number {
    const original = fs.readFileSync(filePath, 'utf8');
    if (verify) {
        verifyXmlUpgradeTimes(original, filePath);
        return 0;
    }

    const patched = patchXmlUpgradeTimes(original);
    if (patched.changes > 0) {
        fs.writeFileSync(filePath, patched.xml, 'utf8');
    }
    verifyXmlUpgradeTimes(patched.xml, filePath);
    return patched.changes;
}

function patchJson(filePath: string, pretty: boolean, verify: boolean): number {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<Record<string, unknown>>;
    let changes = 0;
    for (const entry of data) {
        const current = String(entry.UpgradeTime ?? '0');
        const expected = getRankUpgradeTime(entry.Rank);
        if (expected !== null && expected !== current) {
            entry.UpgradeTime = expected;
            changes += 1;
        }
    }

    if (verify) {
        if (changes > 0) {
            throw new Error(`${filePath} keeps ${changes} UpgradeTime values outside the configured rank schedule`);
        }
        return 0;
    }

    if (changes > 0) {
        fs.writeFileSync(filePath, pretty ? `${JSON.stringify(data, null, 4)}\n` : JSON.stringify(data));
    }
    return changes;
}

function patchGameSwz(swzPath: string, verify: boolean): number {
    const ctx = parseSwz(swzPath);
    let changes = 0;
    let matchedChunks = 0;

    for (const chunk of ctx.chunks) {
        if (!chunk.xml.includes('<BuildingTypes') && !chunk.xml.includes('<AbilityTypes')) {
            continue;
        }
        matchedChunks += 1;
        if (verify) {
            verifyXmlUpgradeTimes(chunk.xml, `${swzPath} chunk ${chunk.index}`);
            continue;
        }

        const patched = patchXmlUpgradeTimes(chunk.xml);
        if (patched.changes > 0) {
            chunk.xml = patched.xml;
            changes += patched.changes;
        }
        verifyXmlUpgradeTimes(chunk.xml, `${swzPath} chunk ${chunk.index}`);
    }

    if (matchedChunks !== 2) {
        throw new Error(`${swzPath} should contain BuildingTypes and AbilityTypes chunks, found ${matchedChunks}`);
    }

    if (!verify && changes > 0) {
        ensureBackup(swzPath);
        writeSwz(ctx);
    }
    return changes;
}

function main(): void {
    const verify = process.argv.includes('--verify');
    let totalChanges = 0;

    for (const file of DATA_FILES) {
        totalChanges += patchLooseXml(file.xmlPath, verify);
        totalChanges += patchJson(file.jsonPath, file.prettyJson, verify);
    }
    for (const swzPath of GAME_SWZ_FILES) {
        totalChanges += patchGameSwz(swzPath, verify);
    }

    const mode = verify ? 'Verified' : 'Patched';
    console.log(`${mode} home timers by rank schedule (${totalChanges} changes)`);
}

main();
