import type { Node } from "@babel/types";
import * as t from "@babel/types";
import type { JsxTreeNode } from "./types.js";

export const CHILDREN_SLOT = "__CHILDREN__";

function jsxNameToString(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) return `${jsxNameToString(name.object)}.${jsxNameToString(name.property)}`;
  return `${name.namespace.name}:${name.name.name}`;
}

function isChildrenExpression(n: Node | null | undefined): boolean {
  if (!n) return false;
  if (t.isIdentifier(n) && n.name === "children") return true;
  if (t.isMemberExpression(n)) {
    if (t.isIdentifier(n.property) && n.property.name === "children") return true;
  }
  return false;
}

function extractVariableName(node: Node): string | undefined {
  if (t.isIdentifier(node)) return node.name;
  if (t.isMemberExpression(node)) {
    const obj = extractVariableName(node.object);
    const prop = t.isIdentifier(node.property) ? node.property.name : t.isStringLiteral(node.property) ? node.property.value : undefined;
    return obj && prop ? `${obj}.${prop}` : undefined;
  }
  return undefined;
}

function getDynamicExpressionType(expr: Node): { type: 'map' | 'filter' | 'ternary' | 'logical' | 'call' | 'other', variable?: string, operation?: string } {
  if (t.isCallExpression(expr)) {
    const callee = expr.callee;
    if (t.isMemberExpression(callee)) {
      const method = t.isIdentifier(callee.property) ? callee.property.name : undefined;
      const variable = extractVariableName(callee.object);
      if (method && ['map', 'filter', 'reduce', 'find', 'some', 'every', 'forEach'].includes(method)) {
        return { type: method as 'map' | 'filter', variable, operation: method };
      }
    }
    return { type: 'call' };
  }
  if (t.isConditionalExpression(expr)) {
    const test = expr.test;
    const variable = extractVariableName(test);
    return { type: 'ternary', variable, operation: '?:' };
  }
  if (t.isLogicalExpression(expr)) {
    const variable = extractVariableName(expr.left);
    return { type: 'logical', variable, operation: expr.operator };
  }
  return { type: 'other' };
}

function collectJsxFromExpression(expr: Node | null | undefined, out: Array<t.JSXElement | t.JSXFragment>): { dynamicInfo?: { type: 'map' | 'filter' | 'ternary' | 'logical' | 'call' | 'other', variable?: string, operation?: string }, jsxCount: number } {
  if (!expr) return { jsxCount: 0 };

  if (t.isJSXElement(expr) || t.isJSXFragment(expr)) {
    out.push(expr);
    return { jsxCount: 1 };
  }

  if (t.isParenthesizedExpression(expr)) return collectJsxFromExpression(expr.expression, out);
  if (t.isSequenceExpression(expr)) {
    let totalJsxCount = 0;
    for (const e of expr.expressions) {
      const result = collectJsxFromExpression(e as unknown as Node, out);
      totalJsxCount += result.jsxCount;
    }
    return { jsxCount: totalJsxCount };
  }
  if (t.isLogicalExpression(expr)) {
    const leftResult = collectJsxFromExpression(expr.left as unknown as Node, out);
    const rightResult = collectJsxFromExpression(expr.right as unknown as Node, out);
    return { dynamicInfo: getDynamicExpressionType(expr), jsxCount: leftResult.jsxCount + rightResult.jsxCount };
  }
  if (t.isConditionalExpression(expr)) {
    const consequentResult = collectJsxFromExpression(expr.consequent as unknown as Node, out);
    const alternateResult = collectJsxFromExpression(expr.alternate as unknown as Node, out);
    return { dynamicInfo: getDynamicExpressionType(expr), jsxCount: consequentResult.jsxCount + alternateResult.jsxCount };
  }
  if (t.isCallExpression(expr)) {
    let totalJsxCount = 0;
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) {
        if (t.isArrowFunctionExpression(arg)) {
          // Handle arrow function expressions
          if (t.isExpression(arg.body)) {
            const result = collectJsxFromExpression(arg.body as unknown as Node, out);
            totalJsxCount += result.jsxCount;
          } else if (t.isBlockStatement(arg.body)) {
            // Handle block statements in arrow functions
            for (const statement of arg.body.body) {
              if (t.isReturnStatement(statement) && t.isExpression(statement.argument)) {
                const result = collectJsxFromExpression(statement.argument as unknown as Node, out);
                totalJsxCount += result.jsxCount;
              }
            }
          }
        } else {
          const result = collectJsxFromExpression(arg as unknown as Node, out);
          totalJsxCount += result.jsxCount;
        }
      }
    }
    if (totalJsxCount > 0) {
      return { dynamicInfo: getDynamicExpressionType(expr), jsxCount: totalJsxCount };
    }
    return { jsxCount: 0 };
  }
  if (t.isArrayExpression(expr)) {
    let totalJsxCount = 0;
    for (const el of expr.elements) {
      if (t.isExpression(el)) {
        const result = collectJsxFromExpression(el as unknown as Node, out);
        totalJsxCount += result.jsxCount;
      }
    }
    return { jsxCount: totalJsxCount };
  }
  if (t.isObjectExpression(expr)) {
    let totalJsxCount = 0;
    for (const prop of expr.properties) {
      if (t.isObjectProperty(prop) && t.isExpression(prop.value)) {
        const result = collectJsxFromExpression(prop.value as unknown as Node, out);
        totalJsxCount += result.jsxCount;
      }
    }
    return { jsxCount: totalJsxCount };
  }
  return { jsxCount: 0 };
}

type ChildItem = t.JSXElement | t.JSXFragment | { slot: "children" } | { dynamicExpression: { type: 'map' | 'filter' | 'ternary' | 'logical' | 'call' | 'other', variable?: string, operation?: string }, children: Array<t.JSXElement | t.JSXFragment> };

function childrenFromJsx(node: t.JSXElement | t.JSXFragment): ChildItem[] {
  const rawChildren = t.isJSXElement(node) ? node.children : node.children;
  const out: ChildItem[] = [];
  for (const ch of rawChildren) {
    if (t.isJSXElement(ch) || t.isJSXFragment(ch)) {
      out.push(ch);
      continue;
    }
    if (t.isJSXExpressionContainer(ch)) {
      const expr = ch.expression as unknown as Node;
      if (isChildrenExpression(expr)) {
        out.push({ slot: "children" });
        continue;
      }
      const jsxElements: Array<t.JSXElement | t.JSXFragment> = [];
      const result = collectJsxFromExpression(expr, jsxElements);
      
      if (result.dynamicInfo && result.jsxCount > 0) {
        out.push({ 
          dynamicExpression: result.dynamicInfo, 
          children: jsxElements 
        });
      } else {
        out.push(...jsxElements);
      }
      continue;
    }
    // Ignore JSXText / JSXSpreadChild etc.
  }
  return out;
}

export function jsxAstToTree(ast: t.JSXElement | t.JSXFragment): JsxTreeNode[] {
  if (t.isJSXFragment(ast)) {
    const out: JsxTreeNode[] = [];
    for (const child of childrenFromJsx(ast)) {
      if ("slot" in child) {
        out.push({ name: CHILDREN_SLOT, children: [] });
      } else if ("dynamicExpression" in child) {
        const dynamicInfo = child.dynamicExpression;
        const variableName = dynamicInfo.variable || 'VAR';
        const operation = dynamicInfo.operation || '';
        
        let displayName = variableName;
        if (dynamicInfo.type === 'map' || dynamicInfo.type === 'filter') {
          displayName = `${variableName}.${operation} (`;
        } else if (dynamicInfo.type === 'ternary') {
          displayName = `${variableName} ? (`;
        } else if (dynamicInfo.type === 'logical') {
          displayName = `${variableName} ${operation} (`;
        }
        
        out.push({ 
          name: displayName, 
          children: child.children.flatMap((c: t.JSXElement | t.JSXFragment) => jsxAstToTree(c)),
          dynamicExpression: dynamicInfo
        });
      } else {
        out.push(...jsxAstToTree(child));
      }
    }
    return out;
  }

  const name = jsxNameToString(ast.openingElement.name);
  const childrenAst = childrenFromJsx(ast);
  const children = childrenAst.flatMap((c) =>
    "slot" in c ? [{ name: CHILDREN_SLOT, children: [] }] : 
    "dynamicExpression" in c ? [{
      name: (() => {
        const dynamicInfo = c.dynamicExpression;
        const variableName = dynamicInfo.variable || 'VAR';
        const operation = dynamicInfo.operation || '';
        
        if (dynamicInfo.type === 'map' || dynamicInfo.type === 'filter') {
          return `${variableName}.${operation} (`;
        } else if (dynamicInfo.type === 'ternary') {
          return `${variableName} ? (`;
        } else if (dynamicInfo.type === 'logical') {
          return `${variableName} ${operation} (`;
        }
        return variableName;
      })(),
      children: c.children.flatMap((child: t.JSXElement | t.JSXFragment) => jsxAstToTree(child)),
      dynamicExpression: c.dynamicExpression
    }] : jsxAstToTree(c)
  );
  return [{ name, children }];
}

export function coerceSingleRoot(nodes: JsxTreeNode[]): JsxTreeNode {
  if (nodes.length === 1) return nodes[0];
  return { name: "Fragment", children: nodes };
}

