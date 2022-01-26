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

import globalNodeResolver from "./global-node";
import { NodeBuilder } from "../../../tests/utils/builders/node-builder";

describe("Global node resolver", () => {
    test("should return the correct type, args and resolve", () => {
        const node = new NodeBuilder({
            name: "Movie",
            primitiveFields: [
                {
                    fieldName: "title",
                    typeMeta: {
                        name: "String",
                        array: false,
                        required: false,
                        pretty: "String",
                        input: {
                            where: {
                                type: "String",
                                pretty: "String",
                            },
                            create: { type: "String", pretty: "String" },
                            update: { type: "String", pretty: "String" },
                        },
                    },
                    otherDirectives: [],
                    arguments: [],
                },
            ],
        })
            .withNodeDirective({ global: true, idField: "title" })
            .instance();

        const result = globalNodeResolver({ nodes: [node] });
        expect(result.type).toBe("Node");
        expect(result.resolve).toBeInstanceOf(Function);
        expect(result.args).toMatchObject({
            id: "ID!",
        });
    });
});