import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    // 核心实现函数
    let imp = async function (includeLine: boolean, includeFunc: boolean) {
        let editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.isUntitled) {
            return '';
        }

        let doc = editor.document;
        let output = doc.fileName.split(/[\\/]/).pop() || '';

        // 1. 处理行号
        if (includeLine) {
            if (editor.selection.isEmpty) {
                output += ':' + (editor.selection.active.line + 1);
            } else {
                let start = editor.selection.start.line + 1;
                let end = editor.selection.end.line + 1;
                output += (start === end) ? `:${start}` : `:${start}-${end}`;
            }
        }

        // 2. 处理函数名
        if (includeFunc) {
            const langId = doc.languageId;
            let funcPart = '';

            // 如果是 Java，直接使用你原来的正则回退逻辑
            if (langId === 'java') {
                let text = doc.getText(editor.selection);
                if (!text) text = doc.lineAt(editor.selection.active.line).text;

                let lines = text.split('\n');
                for (const line of lines) {
                    let regex = /\s*\b(?:public|private)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(/g;
                    let match = regex.exec(line);
                    if (match) {
                        funcPart = ':' + match[1] + '()';
                        break;
                    }
                }
            }
            // 如果是 C/C++/ObjC，使用 LSP
            else if (['c', 'cpp', 'objective-c', 'objective-cpp'].includes(langId)) {
                funcPart = await getLspFunctionName(doc, editor.selection.active);
            }

            output += funcPart;
        }

        return output;
    };

    async function getLspFunctionName(doc: vscode.TextDocument, pos: vscode.Position): Promise<string> {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                doc.uri
            );

            if (!symbols) return '';
            const info = findSymbolWithParent(symbols, pos);
            if (!info) return '';

            const { symbol, container } = info;
            const langId = doc.languageId;
            let name = symbol.name;

            // --- C/C++ 增强解析 ---
            if (langId === 'cpp' || langId === 'c') {
                /* 方案：利用 clangd 的 symbol.detail。
                   在较新版本的 clangd 中，如果提供了 compile_commands.json，
                   symbol.detail 通常存储的是 "(int task_id, string name)" 这样的签名。
                */
                if (symbol.detail) {
                    // 1. 如果 detail 已经是括号开头的参数列表
                    if (symbol.detail.startsWith('(')) {
                        name = `${symbol.name}${symbol.detail}`;
                    }
                    // 2. 如果 detail 是返回类型 (如 "void (uint64_t)")，提取括号部分
                    else if (symbol.detail.includes('(')) {
                        const parenMatch = symbol.detail.match(/\(.*\)/);
                        if (parenMatch) {
                            name = `${symbol.name}${parenMatch[0]}`;
                        }
                    }
                }

                // 拼接 C++ 类名作用域
                if (container && (container.kind === vscode.SymbolKind.Class || container.kind === vscode.SymbolKind.Struct)) {
                    name = `${container.name}::${name}`;
                }
            }
            // --- ObjC 处理 ---
            else if (langId.startsWith('objective')) {
                if (container && (container.kind === vscode.SymbolKind.Class || container.kind === vscode.SymbolKind.Interface)) {
                    return `:[${container.name} ${name}]`;
                }
            }

            // 补全括号安全检查
            if (!name.includes('(') && !langId.startsWith('objective')) {
                name += '()';
            }

            return `:${name}`;
        } catch (e) {
            return '';
        }
    }

    function findSymbolWithParent(symbols: vscode.DocumentSymbol[], pos: vscode.Position, parent?: vscode.DocumentSymbol): any {
        for (const s of symbols) {
            if (s.range.contains(pos)) {
                if (s.children && s.children.length > 0) {
                    const child = findSymbolWithParent(s.children, pos, s);
                    if (child) return child;
                }
                if ([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor].includes(s.kind)) {
                    return { symbol: s, container: parent };
                }
            }
        }
        return undefined;
    }

    const copy = async (l: boolean, f: boolean) => {
        const msg = await imp(l, f);
        if (msg) {
            await vscode.env.clipboard.writeText(msg);
            vscode.window.setStatusBarMessage(`"${msg}" copied`, 3000);
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('file-line-reference.copy-file-line', () => copy(true, false)),
        vscode.commands.registerCommand('file-line-reference.copy-file-function', () => copy(false, true)),
        vscode.commands.registerCommand('file-line-reference.copy-file-line-function', () => copy(true, true))
    );
}