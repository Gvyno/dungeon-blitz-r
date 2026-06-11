#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TARGET_SWFS = [
    path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'DungeonBlitz.swf')
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
            '  node src/server/scripts/patch-dungeonblitz-linkupdater-incremental-guard.js [--verify] [--swf <path>] [--ffdec <path>]',
            '',
            'Defaults:',
            '  patches the served DungeonBlitz SWF so LinkUpdater.method_1072 ignores',
            '  incremental entity updates for entities whose physics/state object was already destroyed.'
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
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec-cli.jar'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.sh'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec-cli.jar'),
        path.join(repoRoot, 'build', 'tools', 'ffdec_25.1.3', 'ffdec.sh'),
        '/Applications/FFDec.app/Contents/Resources/ffdec.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec-cli.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh'
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
    const env = { ...process.env, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ''} -Djava.awt.headless=true`.trim() };

    if (basename.endsWith('.jar')) {
        execFileSync('java', ['-jar', resolved, '-cli', ...args], {
            env,
            stdio: 'inherit'
        });
        return;
    }

    execFileSync(resolved, ['-cli', ...args], {
        env,
        stdio: 'inherit'
    });
}

function exportLinkUpdater(ffdecPath, workRoot, swfPath) {
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
    runFfdec(ffdecPath, ['-selectclass', 'LinkUpdater', '-export', 'script', workRoot, swfPath]);

    const linkUpdaterPath = path.join(workRoot, 'scripts', 'LinkUpdater.as');
    if (!fs.existsSync(linkUpdaterPath)) {
        throw new Error(`FFDec export did not produce ${linkUpdaterPath}`);
    }

    return linkUpdaterPath;
}

function patchLinkUpdater(source, swfPath) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const join = (lines) => lines.join(eol);
    const patchedLookupBlock = join([
        '         _loc2_ = param1.method_4();',
        '         _loc3_ = this.var_1.GetEntFromID(_loc2_);',
        '         if(!_loc3_ || !_loc3_.var_38)',
        '         {',
        '            return;',
        '         }'
    ]);

    if (!source.includes(patchedLookupBlock)) {
        const originalLookupBlock = join([
            '         _loc2_ = param1.method_4();',
            '         _loc3_ = this.var_1.GetEntFromID(_loc2_);',
            '         if(!_loc3_)',
            '         {',
            '            return;',
            '         }'
        ]);

        if (!source.includes(originalLookupBlock)) {
            throw new Error(`${path.basename(swfPath)} has an unexpected LinkUpdater.method_1072 entity lookup block.`);
        }

        source = source.replace(originalLookupBlock, patchedLookupBlock);
    }

    const patchedVelocityBlock = join([
        '            if(_loc3_.entState != Entity.const_6 && Boolean(_loc3_.velocity))',
        '            {',
        '               _loc3_.SetCurrSurface(null);',
        '               _loc3_.velocity.y = _loc9_;',
        '            }'
    ]);
    if (!source.includes(patchedVelocityBlock)) {
        const originalVelocityBlock = join([
            '            if(_loc3_.entState != Entity.const_6)',
            '            {',
            '               _loc3_.SetCurrSurface(null);',
            '               _loc3_.velocity.y = _loc9_;',
            '            }'
        ]);

        if (!source.includes(originalVelocityBlock)) {
            throw new Error(`${path.basename(swfPath)} has an unexpected LinkUpdater.method_1072 velocity block.`);
        }

        source = source.replace(originalVelocityBlock, patchedVelocityBlock);
    }

    const patchedDeathCounterBlock = join([
        '            if(_loc3_.var_20 & Entity.PLAYER && Boolean(this.var_1.level))',
        '            {',
        '               ++this.var_1.level.var_1270;',
        '            }'
    ]);
    if (!source.includes(patchedDeathCounterBlock)) {
        const originalDeathCounterBlock = join([
            '            if(_loc3_.var_20 & Entity.PLAYER)',
            '            {',
            '               ++this.var_1.level.var_1270;',
            '            }'
        ]);

        if (!source.includes(originalDeathCounterBlock)) {
            throw new Error(`${path.basename(swfPath)} has an unexpected LinkUpdater.method_1072 death counter block.`);
        }

        source = source.replace(originalDeathCounterBlock, patchedDeathCounterBlock);
    }

    const patchedVisibilityBlock = join([
        '         if(_loc3_.var_38.var_1667)',
        '         {',
        '            _loc3_.var_38.var_1667 = false;',
        '            _loc3_.var_38.var_556 = true;',
        '            if(Boolean(_loc3_.gfx) && Boolean(_loc3_.gfx.m_TheDO))',
        '            {',
        '               _loc3_.gfx.m_TheDO.visible = true;',
        '            }',
        '         }'
    ]);
    if (!source.includes(patchedVisibilityBlock)) {
        const originalVisibilityBlock = join([
            '         if(_loc3_.var_38.var_1667)',
            '         {',
            '            _loc3_.var_38.var_1667 = false;',
            '            _loc3_.var_38.var_556 = true;',
            '            _loc3_.gfx.m_TheDO.visible = true;',
            '         }'
        ]);

        if (!source.includes(originalVisibilityBlock)) {
            throw new Error(`${path.basename(swfPath)} has an unexpected LinkUpdater.method_1072 visibility block.`);
        }

        source = source.replace(originalVisibilityBlock, patchedVisibilityBlock);
    }

    return source;
}

function verifyLinkUpdater(source, swfPath) {
    const normalized = source.replace(/\r\n/g, '\n');
    const requiredPatterns = [
        'if(!_loc3_ || !_loc3_.var_38)',
        'if(_loc3_.entState != Entity.const_6 && Boolean(_loc3_.velocity))',
        'if(_loc3_.var_20 & Entity.PLAYER && Boolean(this.var_1.level))',
        'if(Boolean(_loc3_.gfx) && Boolean(_loc3_.gfx.m_TheDO))'
    ];

    for (const pattern of requiredPatterns) {
        if (!normalized.includes(pattern)) {
            throw new Error(`${path.basename(swfPath)} is missing LinkUpdater.method_1072 guard pattern: ${pattern}`);
        }
    }

    const unsafePatterns = [
        '         _loc2_ = param1.method_4();',
        '         _loc3_ = this.var_1.GetEntFromID(_loc2_);',
        '         if(!_loc3_)',
        '         {',
        '            return;',
        '         }'
    ];
    if (normalized.includes(unsafePatterns.join('\n'))) {
        throw new Error(`${path.basename(swfPath)} still contains the unguarded LinkUpdater.method_1072 lookup block.`);
    }
}

function patchSwf(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(
        repoRoot,
        'build',
        'ffdec-dungeonblitz-linkupdater-incremental-guard',
        path.basename(swfPath, path.extname(swfPath))
    );
    const linkUpdaterPath = exportLinkUpdater(ffdecPath, workRoot, swfPath);
    const original = fs.readFileSync(linkUpdaterPath, 'utf8');
    const patched = patchLinkUpdater(original, swfPath);

    if (patched !== original) {
        fs.writeFileSync(linkUpdaterPath, patched, 'utf8');
        const patchedSwfPath = path.join(workRoot, path.basename(swfPath));
        runFfdec(ffdecPath, ['-importScript', swfPath, patchedSwfPath, path.dirname(linkUpdaterPath)]);
        fs.copyFileSync(patchedSwfPath, swfPath);
    }

    verifySwf(repoRoot, ffdecPath, swfPath);
}

function verifySwf(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(
        repoRoot,
        'build',
        'ffdec-dungeonblitz-linkupdater-incremental-guard-verify',
        path.basename(swfPath, path.extname(swfPath))
    );
    const linkUpdaterPath = exportLinkUpdater(ffdecPath, workRoot, swfPath);
    verifyLinkUpdater(fs.readFileSync(linkUpdaterPath, 'utf8'), swfPath);
}

function resolveTargets(repoRoot, requestedSwfs) {
    const requested = requestedSwfs.length ? requestedSwfs : TARGET_SWFS;
    return requested.map((entry) => resolvePath(repoRoot, entry));
}

function main() {
    const repoRoot = resolveRepoRoot();
    const args = parseArgs(process.argv);
    const ffdecPath = detectFfdec(repoRoot, args.ffdec);
    if (!ffdecPath) {
        throw new Error('FFDec not found. Pass --ffdec or restore the repo-bundled FFDec app.');
    }

    for (const swfPath of resolveTargets(repoRoot, args.swfs)) {
        if (!fs.existsSync(swfPath)) {
            throw new Error(`SWF not found: ${swfPath}`);
        }

        if (args.verify) {
            verifySwf(repoRoot, ffdecPath, swfPath);
            console.log(`[patch-dungeonblitz-linkupdater-incremental-guard] Verified ${swfPath}`);
            continue;
        }

        patchSwf(repoRoot, ffdecPath, swfPath);
        console.log(`[patch-dungeonblitz-linkupdater-incremental-guard] Patched ${swfPath}`);
    }
}

try {
    main();
} catch (error) {
    console.error(`[patch-dungeonblitz-linkupdater-incremental-guard] ${error.message}`);
    process.exitCode = 1;
}
