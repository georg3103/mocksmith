import type { Rule } from 'eslint';

const ALLOWED_CALLEES = new Set(['defineTestScenario', 'defineScenario', 'defineEndpoint']);

type Node = { type: string; [key: string]: unknown };

const isScenarioConst = (declaration: Node) => {
  const declarators = declaration.declarations as Node[] | undefined;

  return (
    declaration.kind === 'const' &&
    Boolean(declarators?.every((declarator) => {
      const init = declarator.init as Node | undefined;
      const callee = init?.callee as Node | undefined;

      return (
        init?.type === 'CallExpression' &&
        callee?.type === 'Identifier' &&
        ALLOWED_CALLEES.has(callee.name as string)
      );
    }))
  );
};

/**
 * Keeps scenario files declarative: a scenario file holds only imports and
 * scenario definitions. Case-specific constants (response bodies, ids, texts)
 * belong next to the test, so the mock and the assertions share one constant
 * instead of drifting apart.
 * */
export const scenarioFilePurity: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A scenario file contains only the scenario definition: imports and const declarations initialised with defineTestScenario(...) / defineScenario(...) / defineEndpoint(...).',
      recommended: true,
    },
    schema: [],
    messages: {
      impureTopLevel:
        'Only imports and const declarations initialised with defineTestScenario(...) / defineScenario(...) / defineEndpoint(...) are allowed at the top level of a scenario file. Keep case constants (response bodies, ids, texts) in a setup file next to the test and import them here, so the mock and the test assertions share one constant.',
    },
  },
  create(context) {
    return {
      Program(program) {
        for (const node of program.body as unknown as Node[]) {
          if (node.type === 'ImportDeclaration') {
            continue;
          }

          if (node.type === 'VariableDeclaration' && isScenarioConst(node)) {
            continue;
          }

          const declaration = node.declaration as Node | undefined;

          if (
            node.type === 'ExportNamedDeclaration' &&
            declaration?.type === 'VariableDeclaration' &&
            isScenarioConst(declaration)
          ) {
            continue;
          }

          context.report({
            node: node as never,
            messageId: 'impureTopLevel',
          });
        }
      },
    };
  },
};
