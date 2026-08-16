import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
/**
 * Compiler-authoritative semantic evidence provider (Issue #7). Discovers
 * the workspace's TypeScript project configuration, builds a Program using
 * full TypeScript compiler/TypeChecker semantics, and emits both lossless
 * raw evidence and normalized observations (Issue #5 envelope) for
 * declarations/symbols, references, imports/exports, type relationships,
 * extends/implements, and statically resolvable calls.
 */
export function createTypeScriptProvider() {
    return {
        identity: { id: "typescript", version: ts.version, determinism: "deterministic" },
        async isAvailable(context) {
            return findTsconfig(context.workspaceRoot) !== undefined;
        },
        async execute(context) {
            const startedAt = new Date().toISOString();
            const tsconfigPath = findTsconfig(context.workspaceRoot);
            if (tsconfigPath === undefined) {
                throw new Error("no tsconfig.json found in workspace");
            }
            const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
            if (configFile.error) {
                throw new Error(formatDiagnostic(configFile.error));
            }
            const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
            const program = ts.createProgram({
                rootNames: parsed.fileNames,
                options: parsed.options,
            });
            const checker = program.getTypeChecker();
            const rootFileNames = new Set(parsed.fileNames.map((file) => path.resolve(file)));
            const sourceFiles = program
                .getSourceFiles()
                .filter((sf) => !sf.isDeclarationFile && rootFileNames.has(path.resolve(sf.fileName)));
            const collector = new ObservationCollector(checker, context);
            for (const sourceFile of sourceFiles) {
                collector.visitSourceFile(sourceFile);
            }
            const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => formatDiagnosticEntry(diagnostic));
            const metaRelativePath = "meta.json";
            const meta = {
                typescriptVersion: ts.version,
                tsconfigPath: path.relative(context.workspaceRoot, tsconfigPath),
                compilerOptions: sanitizeCompilerOptions(parsed.options),
                rootFiles: parsed.fileNames.map((file) => path.relative(context.workspaceRoot, file)).sort(),
                diagnosticCount: diagnostics.length,
            };
            await writeFile(path.join(context.artifactRoot, metaRelativePath), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
            const diagnosticsRelativePath = "diagnostics.json";
            await writeFile(path.join(context.artifactRoot, diagnosticsRelativePath), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
            const observationsRelativePath = "observations.jsonl";
            const observationsLines = collector.observations.map((observation) => JSON.stringify(observation));
            await writeFile(path.join(context.artifactRoot, observationsRelativePath), observationsLines.length > 0 ? `${observationsLines.join("\n")}\n` : "", "utf8");
            const nativeDir = "native";
            await mkdir(path.join(context.artifactRoot, nativeDir), { recursive: true });
            const nativeArtifacts = [];
            for (const [relPath, symbols] of collector.nativeBySourceFile) {
                const nativeRelativePath = path.join(nativeDir, `${sanitizeFileName(relPath)}.json`);
                await writeFile(path.join(context.artifactRoot, nativeRelativePath), `${JSON.stringify(symbols, null, 2)}\n`, "utf8");
                nativeArtifacts.push(nativeRelativePath);
            }
            return {
                status: "ok",
                artifacts: [metaRelativePath, diagnosticsRelativePath, observationsRelativePath, ...nativeArtifacts],
                startedAt,
                finishedAt: new Date().toISOString(),
            };
        },
    };
}
function findTsconfig(workspaceRoot) {
    const candidate = path.join(workspaceRoot, "tsconfig.json");
    return ts.sys.fileExists(candidate) ? candidate : undefined;
}
function sanitizeCompilerOptions(options) {
    const sanitized = {};
    for (const [key, value] of Object.entries(options)) {
        if (key === "configFilePath")
            continue;
        if (typeof value === "object" && value !== null)
            continue;
        sanitized[key] = value;
    }
    return sanitized;
}
function sanitizeFileName(relPath) {
    return relPath.replace(/[\\/]/gu, "__");
}
function formatDiagnostic(diagnostic) {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
function formatDiagnosticEntry(diagnostic) {
    const entry = {
        category: ts.DiagnosticCategory[diagnostic.category],
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
    if (diagnostic.file && diagnostic.start !== undefined) {
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        entry.file = diagnostic.file.fileName;
        entry.line = line + 1;
        entry.column = character + 1;
    }
    return entry;
}
/** Declarations that carry a symbol worth emitting as a `defines` observation. */
const NAMED_DECLARATION_KINDS = new Set([
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.MethodSignature,
    ts.SyntaxKind.PropertyDeclaration,
    ts.SyntaxKind.PropertySignature,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
]);
class ObservationCollector {
    checker;
    observations = [];
    nativeBySourceFile = new Map();
    repository;
    workspaceRoot;
    providerIdentity;
    constructor(checker, context) {
        this.checker = checker;
        this.repository = context.repository;
        this.workspaceRoot = context.workspaceRoot;
        this.providerIdentity = { id: "typescript", version: ts.version, determinism: "deterministic" };
    }
    visitSourceFile(sourceFile) {
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        const nativeEntries = [];
        this.nativeBySourceFile.set(relPath, nativeEntries);
        const visit = (node) => {
            if (NAMED_DECLARATION_KINDS.has(node.kind)) {
                this.emitDefinition(sourceFile, node, nativeEntries);
            }
            if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
                this.emitHeritage(sourceFile, node);
            }
            if (ts.isImportDeclaration(node)) {
                this.emitImport(sourceFile, node);
            }
            if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
                this.emitExport(sourceFile, node);
            }
            if (ts.isCallExpression(node)) {
                this.emitCall(sourceFile, node);
            }
            ts.forEachChild(node, visit);
        };
        for (const statement of sourceFile.statements) {
            if (hasExportModifier(statement)) {
                this.emitModifierExport(sourceFile, statement);
            }
        }
        ts.forEachChild(sourceFile, visit);
    }
    span(sourceFile, node) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        return `L${start.line + 1}C${start.character + 1}-L${end.line + 1}C${end.character + 1}`;
    }
    evidence(sourceFile, node) {
        return { path: path.relative(this.workspaceRoot, sourceFile.fileName), span: this.span(sourceFile, node) };
    }
    push(predicate, subject, object, source, native) {
        this.observations.push({
            subject,
            predicate,
            object,
            provider: this.providerIdentity,
            repository: this.repository,
            source,
            determinism: "deterministic",
            providerNative: native,
        });
    }
    emitDefinition(sourceFile, node, nativeEntries) {
        if (node.name === undefined || !isIdentifierLike(node.name))
            return;
        const symbol = this.checker.getSymbolAtLocation(node.name);
        const name = node.name.getText(sourceFile);
        const kind = ts.SyntaxKind[node.kind];
        const span = this.span(sourceFile, node);
        const qualifiedName = symbol ? this.checker.getFullyQualifiedName(symbol) : name;
        const symbolFlags = symbol ? (ts.SymbolFlags[symbol.flags] ?? symbol.flags) : undefined;
        const typeText = symbol ? safeTypeToString(this.checker, symbol, node) : undefined;
        nativeEntries.push({ kind, name, qualifiedName, symbolFlags, type: typeText, span });
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        this.push("defines", { id: relPath, kind: "module" }, { id: qualifiedName, kind }, this.evidence(sourceFile, node), { kind, name, qualifiedName, symbolFlags, type: typeText, span });
    }
    emitHeritage(sourceFile, node) {
        if (node.name === undefined)
            return;
        const subjectSymbol = this.checker.getSymbolAtLocation(node.name);
        const subjectName = subjectSymbol
            ? this.checker.getFullyQualifiedName(subjectSymbol)
            : node.name.getText(sourceFile);
        const subjectKind = ts.SyntaxKind[node.kind];
        for (const clause of node.heritageClauses ?? []) {
            const predicate = clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
            for (const typeExpr of clause.types) {
                const objectName = typeExpr.expression.getText(sourceFile);
                const objectSymbol = this.checker.getSymbolAtLocation(typeExpr.expression);
                const qualifiedObjectName = objectSymbol ? this.checker.getFullyQualifiedName(objectSymbol) : objectName;
                this.push(predicate, { id: subjectName, kind: subjectKind }, { id: qualifiedObjectName, kind: "type-reference" }, this.evidence(sourceFile, typeExpr), { subjectKind, subject: subjectName, predicate, object: qualifiedObjectName });
            }
        }
    }
    emitImport(sourceFile, node) {
        const moduleSpecifier = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/gu, "");
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        this.push("imports", { id: relPath, kind: "module" }, { id: moduleSpecifier, kind: "module" }, this.evidence(sourceFile, node), { text: node.getText(sourceFile) });
    }
    emitExport(sourceFile, node) {
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        const moduleSpecifier = ts.isExportDeclaration(node) && node.moduleSpecifier
            ? node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/gu, "")
            : undefined;
        this.push("exports", { id: relPath, kind: "module" }, { id: moduleSpecifier ?? relPath, kind: "module" }, this.evidence(sourceFile, node), { text: node.getText(sourceFile) });
    }
    emitModifierExport(sourceFile, statement) {
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        const names = declaredNames(statement);
        for (const name of names.length > 0 ? names : [relPath]) {
            this.push("exports", { id: relPath, kind: "module" }, { id: name, kind: "declaration" }, this.evidence(sourceFile, statement), { text: statement.getText(sourceFile).slice(0, 200) });
        }
    }
    emitCall(sourceFile, node) {
        const signature = this.checker.getResolvedSignature(node);
        const declaration = signature?.declaration;
        const calleeText = node.expression.getText(sourceFile);
        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName);
        if (!declaration || !declaration.getSourceFile()) {
            // Unresolved call target (e.g. dynamic/ambient): record what the compiler can see without inventing a resolution.
            return;
        }
        const symbol = this.checker.getSymbolAtLocation(node.expression);
        const calleeName = symbol ? this.checker.getFullyQualifiedName(symbol) : calleeText;
        this.push("calls", { id: `${relPath}#${this.span(sourceFile, node)}`, kind: "call-site" }, { id: calleeName, kind: "function" }, this.evidence(sourceFile, node), { calleeText });
    }
}
function isIdentifierLike(node) {
    return ts.isIdentifier(node);
}
function hasExportModifier(node) {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}
function declaredNames(statement) {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations
            .map((decl) => (ts.isIdentifier(decl.name) ? decl.name.text : undefined))
            .filter((name) => name !== undefined);
    }
    if ((ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
        statement.name !== undefined &&
        ts.isIdentifier(statement.name)) {
        return [statement.name.text];
    }
    return [];
}
function safeTypeToString(checker, symbol, node) {
    try {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        return checker.typeToString(type);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=typescriptProvider.js.map