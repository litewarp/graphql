/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GraphQLResolveInfo } from "graphql";
import { execute } from "../../utils";
import { translateRead } from "../../translate";
import { Node } from "../../classes";
import { Context } from "../../types";
import getNeo4jResolveTree from "../../utils/get-neo4j-resolve-tree";
import { fromGlobalId } from "../../utils/global-ids";

export default function globalNodeResolver({ nodes }: { nodes: Node[] }) {
    // todo: REMOVE
    async function resolve(_root: any, _args: { id: string }, _context: unknown, info: GraphQLResolveInfo) {
        const { label, field, id } = fromGlobalId(_args.id);

        if (!label || !field || !id) return null;

        const node = nodes.find((n) => n.getMainLabel() === label);

        if (!node) return null;

        // modify the resolve tree and append the fragment selectionSet

        const context = _context as Context;
        context.resolveTree = getNeo4jResolveTree(info);

        const [cypher, params] = translateRead({ context, node });
        const executeResult = await execute({
            cypher,
            params,
            defaultAccessMode: "READ",
            context,
        });

        let obj = { id: _args.id, __resolveType: node.name };
        if (executeResult.records.length && executeResult.records[0].this) {
            obj = { ...executeResult.records[0].this, ...obj };
        }

        return obj;
    }
    return {
        type: `Node`,
        resolve,
        args: {
            id: "ID!",
        },
    };
}