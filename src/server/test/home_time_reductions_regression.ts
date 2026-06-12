import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PetConfig } from '../core/PetConfig';
import { parseSwz } from '../scripts/swzPatchUtils';

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

function assertXmlUpgradeTimesMatchRankSchedule(xml: string, label: string): void {
    let seen = 0;
    for (const blockMatch of xml.matchAll(/<(Building|Ability)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g)) {
        const block = blockMatch[0];
        const rank = Number(block.match(/<Rank>(\d+)<\/Rank>/)?.[1] ?? 0);
        const expected = RANK_UPGRADE_TIMES_SECONDS[rank];
        if (expected === undefined) {
            continue;
        }

        seen += 1;
        const value = Number(block.match(/<UpgradeTime>(\d+)<\/UpgradeTime>/)?.[1] ?? -1);
        assert.equal(value, expected, `${label} rank ${rank} should use ${expected}s`);
    }
    assert.ok(seen > 0, `${label} should contain ranked UpgradeTime values`);
}

function assertJsonUpgradeTimesMatchRankSchedule(filePath: string): void {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Array<Record<string, unknown>>;
    assert.ok(data.length > 0, `${path.basename(filePath)} should contain data`);
    let seen = 0;
    for (const entry of data) {
        const rank = Number(entry.Rank ?? 0);
        const expected = RANK_UPGRADE_TIMES_SECONDS[rank];
        if (expected === undefined) {
            continue;
        }

        seen += 1;
        const value = Number(entry.UpgradeTime ?? 0);
        assert.equal(
            value,
            expected,
            `${path.basename(filePath)} ${entry.AbilityName ?? entry.BuildingName ?? 'entry'} rank ${entry.Rank ?? '?'} should use ${expected}s`
        );
    }
    assert.ok(seen > 0, `${path.basename(filePath)} should contain ranked UpgradeTime values`);
}

function assertLooseHomeTimersMatchRankSchedule(): void {
    const xmlDir = path.join(ROOT, 'src', 'client', 'content', 'xml');
    const dataDir = path.join(ROOT, 'src', 'server', 'data');

    for (const fileName of ['BuildingTypes.xml', 'AbilityTypes.xml']) {
        assertXmlUpgradeTimesMatchRankSchedule(
            fs.readFileSync(path.join(xmlDir, fileName), 'utf8'),
            fileName
        );
    }
    for (const fileName of ['BuildingTypes.json', 'AbilityTypes.json']) {
        assertJsonUpgradeTimesMatchRankSchedule(path.join(dataDir, fileName));
    }
}

function assertPackedGameTimersMatchRankSchedule(): void {
    const swzDir = path.join(ROOT, 'src', 'client', 'content', 'localhost', 'p', 'cbq');
    for (const fileName of ['Game.swz', 'Game.en.swz', 'Game.tr.swz']) {
        const chunks = parseSwz(path.join(swzDir, fileName)).chunks.filter((chunk) =>
            chunk.xml.includes('<BuildingTypes') || chunk.xml.includes('<AbilityTypes')
        );
        assert.equal(chunks.length, 2, `${fileName} should contain BuildingTypes and AbilityTypes`);
        for (const chunk of chunks) {
            assertXmlUpgradeTimesMatchRankSchedule(chunk.xml, `${fileName} chunk ${chunk.index}`);
        }
    }
}

function assertPetTimersMatchTierSchedule(): void {
    assert.equal(PetConfig.EGG_HATCH_TIMES[0], 3 * 24 * 60 * 60, 'magic eggs should hatch in three days');
    assert.equal(PetConfig.EGG_HATCH_TIMES[1], 3 * 24 * 60 * 60, 'rare eggs should hatch in three days');
    assert.equal(PetConfig.EGG_HATCH_TIMES[2], 7 * 24 * 60 * 60, 'legendary eggs should hatch in seven days');
    assert.equal(PetConfig.EGG_HATCH_MAX_TIME, 7 * 24 * 60 * 60, 'egg hatching should cap at seven days');
    assert.equal(Math.max(...PetConfig.TRAINING_TIME), 0, 'pet training should stay instant');
}

assertLooseHomeTimersMatchRankSchedule();
assertPackedGameTimersMatchRankSchedule();
assertPetTimersMatchTierSchedule();
console.log('home_time_reductions_regression: ok');
