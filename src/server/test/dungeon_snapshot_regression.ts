import { strict as assert } from 'assert';
import * as net from 'net';
import * as path from 'path';
import { Client } from '../core/Client';
import { getStoredDungeonSnapshot } from '../core/DungeonSnapshot';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { Character } from '../database/Database';
import { CharacterHandler } from '../handlers/CharacterHandler';

function createCharacter(name: string): Character {
    return {
        name,
        class: 'Paladin',
        gender: 'male',
        level: 1,
        CurrentLevel: { name: 'JadeCity', x: 10399, y: 1043 },
        PreviousLevel: { name: 'WolfsEnd', x: 1210, y: 880 }
    };
}

function withMockedRandom(values: number[], fn: () => void): void {
    const originalRandom = Math.random;
    let nextIndex = 0;
    Math.random = () => values[Math.min(nextIndex++, values.length - 1)] ?? 0;
    try {
        fn();
    } finally {
        Math.random = originalRandom;
    }
}

function createEnterWorldClient(character: Character): any {
    return {
        userId: 41,
        account: null,
        characters: [character],
        sendBitBuffer() {
            return undefined;
        }
    };
}

function resetGlobalState(): void {
    GlobalState.sessionsByToken.clear();
    GlobalState.sessionsByUserId.clear();
    GlobalState.sessionsByCharacterName.clear();
    GlobalState.pendingWorld.clear();
    GlobalState.pendingExtended.clear();
    GlobalState.usedTransferTokens.clear();
    GlobalState.tokenChar.clear();
    GlobalState.transferTokenAliases.clear();
    GlobalState.levelEntities.clear();
    GlobalState.partyByMember.clear();
}

function ensureLevelConfigLoaded(): void {
    if (!LevelConfig.has('JC_Mission1')) {
        LevelConfig.load(path.resolve(__dirname, '../data'));
    }
}

function testDungeonDisconnectPersistsResumeSnapshot(): void {
    const client = new Client(
        new net.Socket(),
        {
            handle: async () => undefined
        } as never
    );
    const character = createCharacter('SnapshotHero');
    character.questTrackerState = 64;

    client.userId = 41;
    client.authenticated = true;
    client.character = character;
    client.characters = [character];
    client.token = 19301;
    client.clientEntID = 501;
    client.currentLevel = 'JC_Mission1';
    client.levelInstanceId = 'jc-mission1-run';
    client.entryLevel = 'JadeCity';
    client.entryX = 10399;
    client.entryY = 1043;
    client.entryHasCoord = true;
    client.currentRoomId = 8;
    client.startedRoomEvents.add('JC_Mission1:2');
    client.startedRoomEvents.add('JC_Mission1:8');
    client.startedRoomEvents.add('OtherDungeon:9');
    client.syncAnchorStartedAt = 1700000000;
    client.entities.set(501, { x: 8120, y: -144 });

    (client as any).repairDungeonLocationBeforeSave();

    const snapshot = getStoredDungeonSnapshot(character);
    assert.ok(snapshot, 'disconnecting inside a dungeon should persist a resume snapshot');
    assert.equal(snapshot.levelName, 'JC_Mission1');
    assert.equal(snapshot.levelInstanceId, 'jc-mission1-run');
    assert.equal(snapshot.x, 8120);
    assert.equal(snapshot.y, -144);
    assert.equal(snapshot.entryLevel, 'JadeCity');
    assert.equal(snapshot.entryX, 10399);
    assert.equal(snapshot.entryY, 1043);
    assert.equal(snapshot.currentRoomId, 8);
    assert.deepEqual(snapshot.startedRoomIds, [2, 8]);
    assert.equal(snapshot.questProgress, 64);
    assert.deepEqual(
        character.CurrentLevel,
        { name: 'JadeCity', x: 10399, y: 1043 },
        'disconnect save should leave CurrentLevel at the safe dungeon return point'
    );
}

function testStoredDungeonSnapshotBuildsEnterWorldResumeState(): void {
    const character = createCharacter('SnapshotHero');
    character.DungeonSnapshot = {
        levelName: 'JC_Mission1',
        x: 8120,
        y: -144,
        hasCoord: true,
        levelInstanceId: 'jc-mission1-run',
        entryLevel: 'JadeCity',
        entryX: 10399,
        entryY: 1043,
        entryHasCoord: true,
        currentRoomId: 8,
        startedRoomIds: [2, 8],
        questProgress: 64,
        syncAnchorStartedAt: 1700000000,
        savedAt: 1700000123
    };
    const client = createEnterWorldClient(character);

    withMockedRandom([50002.5 / 0x10000], () => {
        (CharacterHandler as any).sendEnterWorld(client, character);
    });

    const pendingEntry = GlobalState.pendingWorld.get(50002);
    assert.ok(pendingEntry, 'stored dungeon snapshot should create an enter-world pending transfer');
    assert.equal(pendingEntry.targetLevel, 'JC_Mission1');
    assert.equal(pendingEntry.previousLevel, 'JadeCity');
    assert.equal(pendingEntry.levelInstanceId, 'jc-mission1-run');
    assert.equal(pendingEntry.newX, 8120);
    assert.equal(pendingEntry.newY, -144);
    assert.equal(pendingEntry.newHasCoord, true);
    assert.equal(pendingEntry.syncAnchorStartedAt, 1700000000);
    assert.equal(pendingEntry.syncAnchorToken, 50002);
    assert.equal(pendingEntry.syncAnchorCharacterName, 'SnapshotHero');
    assert.equal(pendingEntry.syncEntryLevel, 'JadeCity');
    assert.equal(pendingEntry.syncEntryX, 10399);
    assert.equal(pendingEntry.syncEntryY, 1043);
    assert.equal(pendingEntry.syncEntryHasCoord, true);
    assert.equal(pendingEntry.syncRoomId, 8);
    assert.deepEqual(pendingEntry.syncStartedRoomIds, [2, 8]);
    assert.equal(pendingEntry.syncQuestProgress, 64);
}

function testOverworldSaveClearsStoredDungeonSnapshot(): void {
    const client = new Client(
        new net.Socket(),
        {
            handle: async () => undefined
        } as never
    );
    const character = createCharacter('ReturnedHero');
    character.DungeonSnapshot = {
        levelName: 'JC_Mission1',
        currentRoomId: 8,
        startedRoomIds: [2, 8],
        savedAt: 1700000123
    };

    client.userId = 41;
    client.authenticated = true;
    client.character = character;
    client.characters = [character];
    client.currentLevel = 'JadeCity';

    (client as any).repairDungeonLocationBeforeSave();

    assert.equal(getStoredDungeonSnapshot(character), null, 'saving outside a dungeon should clear stale resume snapshots');
    assert.equal(character.DungeonSnapshot, undefined);
}

function main(): void {
    try {
        ensureLevelConfigLoaded();

        resetGlobalState();
        testDungeonDisconnectPersistsResumeSnapshot();

        resetGlobalState();
        testStoredDungeonSnapshotBuildsEnterWorldResumeState();

        resetGlobalState();
        testOverworldSaveClearsStoredDungeonSnapshot();

        console.log('dungeon_snapshot_regression: ok');
    } catch (error) {
        console.error('dungeon_snapshot_regression: failed');
        console.error(error);
        process.exitCode = 1;
    } finally {
        resetGlobalState();
    }
}

main();
