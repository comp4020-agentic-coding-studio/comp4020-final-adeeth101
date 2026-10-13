import { parse } from 'acorn';
import { validateDocument, type MusicNode, type ClipDocument, type Sound, type Synth, type Op } from './music.ts';
export function printNode(n: MusicNode): string {
  if (n.kind === 'sound') return `s(${JSON.stringify(n.steps.map(x => x ?? '~').join(' '))})`;
  if (n.kind === 'notes') return `note(${JSON.stringify(n.steps.map(x => x ?? '~').join(' '))}).s(${JSON.stringify(n.synth)})`;
  if (n.kind === 'stack') return `stack(${n.children.map(printNode).join(', ')})`;
  return `${printNode(n.child)}.${n.op}(${n.op === 'rev' ? '' : n.value})`;
}
export function parseCode(source: string): ClipDocument {
  if (source.length > 8192) throw new Error('Keep code under 8 KB.');
  // Syntax is parsed, never executed. All unknown AST shapes fail closed.
  let comments = false;
  const ast = parse(source, { ecmaVersion: 2023, locations: true, onComment: () => { comments = true; } });
  if (comments || ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') throw new Error('Use one supported Strudel expression.');
  type Node = { type: string; [key: string]: any };
  function literal(n: Node, type: string) {
    if (n?.type !== 'Literal' || typeof n.value !== type) throw new Error('Use plain strings and numeric literals.');
    return n.value;
  }
  function tokens(n: Node): string[] {
    const s = literal(n, 'string') as string;
    if (!s.trim()) throw new Error('Add a note, sound or rest (~).');
    return s.trim().split(/\s+/);
  }
  function walk(n: Node, depth = 0): MusicNode {
    if (depth > 16 || n?.type !== 'CallExpression' || n.optional || n.arguments.some((a:Node) => a.type === 'SpreadElement')) throw new Error('Unsupported expression: use the listed music functions.');
    if (n.callee.type === 'Identifier') {
      if (n.callee.name === 's' && n.arguments.length === 1) return { kind: 'sound', steps: tokens(n.arguments[0]).map(x => x === '~' ? null : x as Sound) };
      if (n.callee.name === 'stack') return { kind: 'stack', children: n.arguments.map((a:Node) => walk(a, depth + 1)) };
    }
    if (n.callee.type === 'MemberExpression' && !n.callee.computed && !n.callee.optional && n.callee.property.type === 'Identifier') {
      const op = n.callee.property.name;
      const base = n.callee.object;
      if (op === 's' && base.type === 'CallExpression' && base.callee.type === 'Identifier' && base.callee.name === 'note' && base.arguments.length === 1 && n.arguments.length === 1) {
        return { kind: 'notes', synth: literal(n.arguments[0], 'string') as Synth, steps: tokens(base.arguments[0]).map(x => x === '~' ? null : /^\d+$/.test(x) ? Number(x) : NaN) };
      }
      if ((op === 'rev' && n.arguments.length === 0) || (['fast','slow','gain','lpf','room'].includes(op) && n.arguments.length === 1)) {
        return { kind: 'transform', op: op as Op, ...(op !== 'rev' ? { value: literal(n.arguments[0], 'number') as number } : {}), child: walk(base, depth + 1) };
      }
    }
    throw new Error('Unsupported call. Open Supported syntax for the available functions.');
  }
  return validateDocument({ schemaVersion: 1, root: walk(ast.body[0].expression as Node) });
}
