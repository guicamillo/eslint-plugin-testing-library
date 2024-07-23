import {
	AST_NODE_TYPES,
	ASTUtils,
	TSESLint,
	TSESTree,
} from '@typescript-eslint/utils';

import { createTestingLibraryRule } from '../create-testing-library-rule';
import { findClosestCallNode, isMemberExpression } from '../node-utils';

export const RULE_NAME = 'prefer-presence-queries';
export type MessageIds = 'wrongAbsenceQuery' | 'wrongPresenceQuery';
export type Options = [
	{
		presence?: boolean;
		absence?: boolean;
	}
];

function findRenderDefinitionDeclaration(
	scope: TSESLint.Scope.Scope,
	query: string
): TSESTree.Identifier | null {
	if (!scope) {
		return null;
	}

	const variable = scope.variables.find(
		(v: TSESLint.Scope.Variable) => v.name === query
	);

	if (variable) {
		return (
			variable.defs
				.map(({ name }) => name)
				.filter(ASTUtils.isIdentifier)
				.find(({ name }) => name === query) ?? null
		);
	}
	if (!scope.upper) return null;

	return findRenderDefinitionDeclaration(scope.upper, query);
}

function findOriginalMethodDeclaration(
	context: TSESLint.Scope.Scope,
	originalMethodName: string,
	newMethodName: string
) {
	const originalMethodLocation = findRenderDefinitionDeclaration(
		context,
		originalMethodName
	);

	if (!originalMethodLocation) return;

	const definition = originalMethodLocation.parent?.parent;
	if (definition?.type !== AST_NODE_TYPES.ObjectPattern) return;

	const properties = definition.properties;
	const hasNewMethod = properties
		.filter((p) => p.type === AST_NODE_TYPES.Property)
		.some((p) => {
			return (
				p.kind === 'init' &&
				//eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				p.key?.type === AST_NODE_TYPES.Identifier &&
				//eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				p.key?.name === newMethodName
			);
		});

	if (!hasNewMethod) {
		return originalMethodLocation.range;
	}
}

function fixFactory(
	node: TSESTree.Node,
	type: MessageIds,
	scope: TSESLint.Scope.Scope
) {
	const m = {
		wrongAbsenceQuery: ['getBy', 'queryBy'],
		wrongPresenceQuery: ['queryBy', 'getBy'],
	};

	return function (fixer: TSESLint.RuleFixer) {
		if (node.type !== AST_NODE_TYPES.Identifier) {
			return [];
		}

		const [from, to] = m[type];

		const currentName = node.name;
		const targetName = currentName.replace(from, to);

		const nodeFixer = fixer.replaceText(node, targetName);
		const range = findOriginalMethodDeclaration(scope, currentName, targetName);
		if (node.name.startsWith('screen') || !range) {
			return nodeFixer;
		}

		return [{ range, text: [currentName, targetName].join(', ') }, nodeFixer];
	};
}

export default createTestingLibraryRule<Options, MessageIds>({
	name: RULE_NAME,
	meta: {
		fixable: 'code',
		docs: {
			description:
				'Ensure appropriate `get*`/`query*` queries are used with their respective matchers',
			recommendedConfig: {
				dom: 'error',
				angular: 'error',
				react: 'error',
				vue: 'error',
				marko: 'error',
			},
		},
		messages: {
			wrongPresenceQuery:
				'Use `getBy*` queries rather than `queryBy*` for checking element is present',
			wrongAbsenceQuery:
				'Use `queryBy*` queries rather than `getBy*` for checking element is NOT present',
		},
		schema: [
			{
				type: 'object',
				additionalProperties: false,
				properties: {
					presence: {
						type: 'boolean',
					},
					absence: {
						type: 'boolean',
					},
				},
			},
		],
		type: 'suggestion',
	},
	defaultOptions: [
		{
			presence: true,
			absence: true,
		},
	],

	create(context, [{ absence = true, presence = true }], helpers) {
		return {
			'CallExpression Identifier'(node: TSESTree.Identifier) {
				const expectCallNode = findClosestCallNode(node, 'expect');
				const withinCallNode = findClosestCallNode(node, 'within');

				if (!expectCallNode || !isMemberExpression(expectCallNode.parent)) {
					return;
				}

				// Sync queries (getBy and queryBy) are corresponding ones used
				// to check presence or absence. If none found, stop the rule.
				if (!helpers.isSyncQuery(node)) {
					return;
				}

				const isPresenceQuery = helpers.isGetQueryVariant(node);
				const expectStatement = expectCallNode.parent;
				const isPresenceAssert = helpers.isPresenceAssert(expectStatement);
				const isAbsenceAssert = helpers.isAbsenceAssert(expectStatement);

				if (!isPresenceAssert && !isAbsenceAssert) {
					return;
				}

				if (
					presence &&
					(withinCallNode || isPresenceAssert) &&
					!isPresenceQuery
				) {
					context.report({
						node,
						messageId: 'wrongPresenceQuery',
						fix: fixFactory(node, 'wrongPresenceQuery', context.getScope()),
					});
				} else if (
					!withinCallNode &&
					absence &&
					isAbsenceAssert &&
					isPresenceQuery
				) {
					context.report({
						node,
						messageId: 'wrongAbsenceQuery',
						fix: fixFactory(node, 'wrongAbsenceQuery', context.getScope()),
					});
				}
			},
		};
	},
});
