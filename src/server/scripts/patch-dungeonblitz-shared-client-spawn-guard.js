#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TARGETS = [
    {
        swf: path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'DungeonBlitz.swf')
    }
];

function parseArgs(argv) {
    const args = {
        ffdec: '',
        verify: false,
        swfs: []
    };

    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--ffdec' || arg === '-f') {
            args.ffdec = argv[++index] || '';
            continue;
        }
        if (arg === '--swf' || arg === '-s') {
            args.swfs.push(argv[++index] || '');
            continue;
        }
        if (arg === '--verify') {
            args.verify = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    return args;
}

function printHelp() {
    console.log(
        [
            'Usage:',
            '  node src/server/scripts/patch-dungeonblitz-shared-client-spawn-guard.js [--verify] [--swf <path>] [--ffdec <path>]',
            '',
            'Defaults:',
            '  exports and patches Room.SpawnCue in the served DungeonBlitz SWF so party followers',
            '  reuse a nearby server-issued remote monster instead of creating a second local copy.'
        ].join('\n')
    );
}

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function resolvePath(repoRoot, value) {
    if (!value) {
        return '';
    }
    if (path.isAbsolute(value)) {
        return value;
    }
    return path.join(repoRoot, value);
}

function detectFfdec(repoRoot, preferred) {
    const candidates = [];
    if (preferred) {
        candidates.push(resolvePath(repoRoot, preferred));
    }

    candidates.push(
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.sh'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec-cli.jar'),
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh',
        '/Applications/FFDec.app/Contents/Resources/ffdec.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec-cli.jar'
    );

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return '';
}

function runFfdec(ffdecPath, args) {
    const resolved = path.resolve(ffdecPath);
    const basename = path.basename(resolved).toLowerCase();

    if (basename.endsWith('.jar')) {
        execFileSync('java', ['-jar', resolved, '-cli', ...args], {
            stdio: 'inherit'
        });
        return;
    }

    execFileSync(resolved, ['-cli', ...args], {
        stdio: 'inherit'
    });
}

function exportRoom(ffdecPath, workRoot, swfPath) {
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
    runFfdec(ffdecPath, ['-selectclass', 'Room', '-export', 'script', workRoot, swfPath]);

    const roomPath = path.join(workRoot, 'scripts', 'Room.as');
    if (!fs.existsSync(roomPath)) {
        throw new Error(`FFDec export did not produce ${roomPath}`);
    }

    return roomPath;
}

function verifyPatchedRoom(source, swfPath) {
    const requiredPatterns = [
        'var _loc14_:Entity = null;',
        'var _loc15_:Number = NaN;',
        'var _loc16_:Number = NaN;',
        'Boolean(_loc14_.var_20 & Entity.REMOTE)',
        'Boolean(_loc14_.var_20 & Entity.MONSTER)',
        '_loc14_.entType.entName == _loc3_.entName',
        '_loc15_ * _loc15_ + _loc16_ * _loc16_ <= 6400',
        'return _loc14_;'
    ];

    for (const pattern of requiredPatterns) {
        if (!source.includes(pattern)) {
            throw new Error(`${path.basename(swfPath)} is missing shared client-spawn guard pattern: ${pattern}`);
        }
    }
}

function patchRoomSource(source, swfPath) {
    source = source.replace('null.m_TheDO.x + 200 + Math.random() * 200', '_loc34_.m_TheDO.x + 200 + Math.random() * 200');

    if (source.includes('Boolean(_loc14_.var_20 & Entity.REMOTE)') && source.includes('return _loc14_;')) {
        verifyPatchedRoom(source, swfPath);
        return source;
    }

    const localDeclarationPattern = /var _loc11_:int = 0;\r?\n\s*var _loc12_:BehaviorType = null;\r?\n\s*var _loc13_:Point = null;/;
    const patchedLocalDeclaration = [
        'var _loc11_:int = 0;',
        '         var _loc12_:BehaviorType = null;',
        '         var _loc13_:Point = null;',
        '         var _loc14_:Entity = null;',
        '         var _loc15_:Number = NaN;',
        '         var _loc16_:Number = NaN;'
    ].join('\n');

    if (!localDeclarationPattern.test(source)) {
        throw new Error(`${path.basename(swfPath)} has an unexpected SpawnCue local declaration block.`);
    }

    source = source.replace(localDeclarationPattern, patchedLocalDeclaration);

    const spawnLine = 'var _loc7_:uint = uint(Entity.LOCAL | Entity.MONSTER | (param2 ? Entity.const_241 : 0));';
    const guard = [
        spawnLine,
        '         for each(_loc14_ in this.var_1.entities)',
        '         {',
        '            if(Boolean(_loc14_) && Boolean(_loc14_.entType) && Boolean(_loc14_.var_20 & Entity.REMOTE) && Boolean(_loc14_.var_20 & Entity.MONSTER) && _loc14_.team == _loc6_ && _loc14_.entType.entName == _loc3_.entName)',
        '            {',
        '               _loc15_ = Number(_loc14_.physPosX - _loc4_.x);',
        '               _loc16_ = Number(_loc14_.physPosY - _loc4_.y);',
        '               if(_loc15_ * _loc15_ + _loc16_ * _loc16_ <= 6400)',
        '               {',
        '                  param1.bSpawned = true;',
        '                  param1.defeatTick = 0;',
        '                  return _loc14_;',
        '               }',
        '            }',
        '         }'
    ].join('\n');

    if (!source.includes(spawnLine)) {
        throw new Error(`${path.basename(swfPath)} has an unexpected SpawnCue spawn flag block.`);
    }

    source = source.replace(spawnLine, guard);
    verifyPatchedRoom(source, swfPath);
    return source;
}

function patchSwf(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(
        repoRoot,
        'build',
        'ffdec-dungeonblitz-shared-client-spawn-guard',
        path.basename(swfPath, path.extname(swfPath))
    );
    const patchedSwfPath = path.join(workRoot, `${path.basename(swfPath, path.extname(swfPath))}.patched.swf`);
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });

    const roomPath = exportRoom(ffdecPath, workRoot, swfPath);
    const patchedSource = patchRoomSource(fs.readFileSync(roomPath, 'utf8'), swfPath);
    fs.writeFileSync(roomPath, patchedSource);

    const scriptsDir = path.join(workRoot, 'scripts');
    runFfdec(ffdecPath, ['-importScript', swfPath, patchedSwfPath, scriptsDir]);
    fs.copyFileSync(patchedSwfPath, swfPath);
    console.log(`Patched shared client-spawn guard in ${swfPath}`);
}

function verifySwf(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(
        repoRoot,
        'build',
        'ffdec-dungeonblitz-shared-client-spawn-guard-verify',
        path.basename(swfPath, path.extname(swfPath))
    );
    const roomPath = exportRoom(ffdecPath, workRoot, swfPath);
    verifyPatchedRoom(fs.readFileSync(roomPath, 'utf8'), swfPath);
    console.log(`Verified shared client-spawn guard in ${swfPath}`);
}

function main() {
    const repoRoot = resolveRepoRoot();
    const args = parseArgs(process.argv);
    const ffdecPath = detectFfdec(repoRoot, args.ffdec);

    if (!ffdecPath) {
        throw new Error('FFDec not found. Pass --ffdec or install JPEXS FFDec.');
    }

    const requestedSwfs = new Set((args.swfs.length ? args.swfs : TARGETS.map((target) => target.swf)).map((entry) => resolvePath(repoRoot, entry)));
    const selectedTargets = TARGETS
        .map((target) => ({
            swfPath: resolvePath(repoRoot, target.swf)
        }))
        .filter((target) => requestedSwfs.has(target.swfPath));

    if (!selectedTargets.length) {
        throw new Error('No matching SWFs selected for patching.');
    }

    for (const target of selectedTargets) {
        if (!fs.existsSync(target.swfPath)) {
            throw new Error(`SWF not found: ${target.swfPath}`);
        }
    }

    if (args.verify) {
        for (const target of selectedTargets) {
            verifySwf(repoRoot, ffdecPath, target.swfPath);
        }
        return;
    }

    for (const target of selectedTargets) {
        patchSwf(repoRoot, ffdecPath, target.swfPath);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
