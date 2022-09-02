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

import { Neo4jGraphQLAuthJWTPlugin } from "@neo4j/graphql-plugin-auth";
import { gql } from "apollo-server";
import type { DocumentNode } from "graphql";
import { Neo4jGraphQL } from "../../../../../../src";
import { createJwtRequest } from "../../../../../utils/create-jwt-request";
import { formatCypher, translateQuery, formatParams } from "../../../../utils/tck-test-utils";

describe("Cypher Auth Where", () => {
    const secret = "secret";
    let typeDefs: DocumentNode;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = gql`
            union Search = Post

            type User {
                id: ID
                name: String
                posts: [Post!]! @relationship(type: "HAS_POST", direction: OUT)
                content: [Search!]! @relationship(type: "HAS_POST", direction: OUT) # something to test unions
            }

            type Post {
                id: ID
                content: String
                creator: User! @relationship(type: "HAS_POST", direction: IN)
            }

            extend type User
                @auth(rules: [{ operations: [READ, UPDATE, DELETE, CONNECT, DISCONNECT], where: { id: "$jwt.sub" } }])

            extend type User {
                password: String! @auth(rules: [{ operations: [READ], where: { id: "$jwt.sub" } }])
            }

            extend type Post {
                secretKey: String! @auth(rules: [{ operations: [READ], where: { creator: { id: "$jwt.sub" } } }])
            }

            extend type Post
                @auth(
                    rules: [
                        {
                            operations: [READ, UPDATE, DELETE, CONNECT, DISCONNECT]
                            where: { creator: { id: "$jwt.sub" } }
                        }
                    ]
                )
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
            config: { enableRegex: true },
            plugins: {
                auth: new Neo4jGraphQLAuthJWTPlugin({
                    secret,
                }),
            },
        });
    });

    test("Read Node", async () => {
        const query = gql`
            {
                users {
                    id
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            RETURN this { .id } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Node + User Defined Where", async () => {
        const query = gql`
            {
                users(where: { name: "bob" }) {
                    id
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.name = $param0 AND (this.id IS NOT NULL AND this.id = $thisauth_param0))
            RETURN this { .id } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"bob\\",
                \\"thisauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Relationship", async () => {
        const query = gql`
            {
                users {
                    id
                    posts {
                        content
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
                WITH this
                MATCH (this)-[thisthis0:HAS_POST]->(this_posts:\`Post\`)
                WHERE (exists((this_posts)<-[:HAS_POST]-(:\`User\`)) AND all(thisthis1 IN [(this_posts)<-[:HAS_POST]-(thisthis1:\`User\`) | thisthis1] WHERE (thisthis1.id IS NOT NULL AND thisthis1.id = $thisparam0)))
                WITH this_posts { .content } AS this_posts
                RETURN collect(this_posts) AS this_posts
            }
            RETURN this { .id, posts: this_posts } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"thisparam0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Connection", async () => {
        const query = gql`
            {
                users {
                    id
                    postsConnection {
                        edges {
                            node {
                                content
                            }
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
            WITH this
            MATCH (this)-[this_has_post_relationship:HAS_POST]->(this_post:Post)
            WHERE (exists((this_post)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_post)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_postauth_param0)))
            WITH collect({ node: { content: this_post.content } }) AS edges
            UNWIND edges as edge
            WITH collect(edge) AS edges, size(collect(edge)) AS totalCount
            RETURN { edges: edges, totalCount: totalCount } AS postsConnection
            }
            RETURN this { .id, postsConnection } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_postauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Connection + User Defined Where", async () => {
        const query = gql`
            {
                users {
                    id
                    postsConnection(where: { node: { id: "some-id" } }) {
                        edges {
                            node {
                                content
                            }
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
            WITH this
            MATCH (this)-[this_has_post_relationship:HAS_POST]->(this_post:Post)
            WHERE this_post.id = $this_postsConnection_args_where_Postparam0 AND (exists((this_post)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_post)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_postauth_param0)))
            WITH collect({ node: { content: this_post.content } }) AS edges
            UNWIND edges as edge
            WITH collect(edge) AS edges, size(collect(edge)) AS totalCount
            RETURN { edges: edges, totalCount: totalCount } AS postsConnection
            }
            RETURN this { .id, postsConnection } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_postsConnection_args_where_Postparam0\\": \\"some-id\\",
                \\"this_postauth_param0\\": \\"id-01\\",
                \\"this_postsConnection\\": {
                    \\"args\\": {
                        \\"where\\": {
                            \\"node\\": {
                                \\"id\\": \\"some-id\\"
                            }
                        }
                    }
                }
            }"
        `);
    });

    test("Read Union Relationship + User Defined Where", async () => {
        const query = gql`
            {
                users {
                    id
                    posts(where: { content: "cool" }) {
                        content
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
                WITH this
                MATCH (this)-[thisthis0:HAS_POST]->(this_posts:\`Post\`)
                WHERE (this_posts.content = $thisparam0 AND (exists((this_posts)<-[:HAS_POST]-(:\`User\`)) AND all(thisthis1 IN [(this_posts)<-[:HAS_POST]-(thisthis1:\`User\`) | thisthis1] WHERE (thisthis1.id IS NOT NULL AND thisthis1.id = $thisparam1))))
                WITH this_posts { .content } AS this_posts
                RETURN collect(this_posts) AS this_posts
            }
            RETURN this { .id, posts: this_posts } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"thisparam0\\": \\"cool\\",
                \\"thisparam1\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Union", async () => {
        const query = gql`
            {
                users {
                    id
                    content {
                        ... on Post {
                            id
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
                WITH this
                CALL {
                    WITH this
                    MATCH (this)-[thisthis0:HAS_POST]->(this_content:\`Post\`)
                    WHERE (exists((this_content)<-[:HAS_POST]-(:\`User\`)) AND all(thisthis1 IN [(this_content)<-[:HAS_POST]-(thisthis1:\`User\`) | thisthis1] WHERE (thisthis1.id IS NOT NULL AND thisthis1.id = $thisparam0)))
                    WITH this_content  { __resolveType: \\"Post\\",  .id } AS this_content
                    RETURN this_content AS this_content
                }
                WITH this_content
                RETURN collect(this_content) AS this_content
            }
            RETURN this { .id, content: this_content } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"thisparam0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Union Using Connection", async () => {
        const query = gql`
            {
                users {
                    id
                    contentConnection {
                        edges {
                            node {
                                ... on Post {
                                    id
                                }
                            }
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
            WITH this
            CALL {
            WITH this
            MATCH (this)-[this_has_post_relationship:HAS_POST]->(this_Post:Post)
            WHERE (exists((this_Post)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_Post)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_Postauth_param0)))
            WITH { node: { __resolveType: \\"Post\\", id: this_Post.id } } AS edge
            RETURN edge
            }
            WITH collect(edge) as edges
            WITH edges, size(edges) AS totalCount
            RETURN { edges: edges, totalCount: totalCount } AS contentConnection
            }
            RETURN this { .id, contentConnection } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_Postauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Read Union Using Connection + User Defined Where", async () => {
        const query = gql`
            {
                users {
                    id
                    contentConnection(where: { Post: { node: { id: "some-id" } } }) {
                        edges {
                            node {
                                ... on Post {
                                    id
                                }
                            }
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            CALL {
            WITH this
            CALL {
            WITH this
            MATCH (this)-[this_has_post_relationship:HAS_POST]->(this_Post:Post)
            WHERE this_Post.id = $this_contentConnection_args_where_Post_Postparam0 AND (exists((this_Post)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_Post)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_Postauth_param0)))
            WITH { node: { __resolveType: \\"Post\\", id: this_Post.id } } AS edge
            RETURN edge
            }
            WITH collect(edge) as edges
            WITH edges, size(edges) AS totalCount
            RETURN { edges: edges, totalCount: totalCount } AS contentConnection
            }
            RETURN this { .id, contentConnection } as this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_contentConnection_args_where_Post_Postparam0\\": \\"some-id\\",
                \\"this_Postauth_param0\\": \\"id-01\\",
                \\"this_contentConnection\\": {
                    \\"args\\": {
                        \\"where\\": {
                            \\"Post\\": {
                                \\"node\\": {
                                    \\"id\\": \\"some-id\\"
                                }
                            }
                        }
                    }
                }
            }"
        `);
    });

    test("Update Node", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { name: "Bob" }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            SET this.name = $this_update_name
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_update_name\\": \\"Bob\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Update Node + User Defined Where", async () => {
        const query = gql`
            mutation {
                updateUsers(where: { name: "bob" }, update: { name: "Bob" }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.name = $param0 AND (this.id IS NOT NULL AND this.id = $thisauth_param0))
            SET this.name = $this_update_name
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"bob\\",
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_update_name\\": \\"Bob\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Update Nested Node", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { posts: { update: { node: { id: "new-id" } } } }) {
                    users {
                        id
                        posts {
                            id
                        }
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            OPTIONAL MATCH (this)-[this_has_post0_relationship:HAS_POST]->(this_posts0:Post)
            WHERE (exists((this_posts0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0auth_param0)))
            CALL apoc.do.when(this_posts0 IS NOT NULL, \\"
            SET this_posts0.id = $this_update_posts0_id
            WITH this, this_posts0
            CALL {
            	WITH this_posts0
            	MATCH (this_posts0)<-[this_posts0_creator_User_unique:HAS_POST]-(:User)
            	WITH count(this_posts0_creator_User_unique) as c
            	CALL apoc.util.validate(NOT (c = 1), '@neo4j/graphql/RELATIONSHIP-REQUIREDPost.creator required', [0])
            	RETURN c AS this_posts0_creator_User_unique_ignored
            }
            RETURN count(*) AS _
            \\", \\"\\", {this:this, updateUsers: $updateUsers, this_posts0:this_posts0, auth:$auth,this_update_posts0_id:$this_update_posts0_id})
            YIELD value AS _
            WITH *
            CALL {
                WITH this
                MATCH (this)-[update_this0:HAS_POST]->(this_posts:\`Post\`)
                WHERE (exists((this_posts)<-[:HAS_POST]-(:\`User\`)) AND all(update_this1 IN [(this_posts)<-[:HAS_POST]-(update_this1:\`User\`) | update_this1] WHERE (update_this1.id IS NOT NULL AND update_this1.id = $update_param0)))
                WITH this_posts { .id } AS this_posts
                RETURN collect(this_posts) AS this_posts
            }
            RETURN collect(DISTINCT this { .id, posts: this_posts }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"update_param0\\": \\"id-01\\",
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_posts0auth_param0\\": \\"id-01\\",
                \\"this_update_posts0_id\\": \\"new-id\\",
                \\"auth\\": {
                    \\"isAuthenticated\\": true,
                    \\"roles\\": [
                        \\"admin\\"
                    ],
                    \\"jwt\\": {
                        \\"roles\\": [
                            \\"admin\\"
                        ],
                        \\"sub\\": \\"id-01\\"
                    }
                },
                \\"updateUsers\\": {
                    \\"args\\": {
                        \\"update\\": {
                            \\"posts\\": [
                                {
                                    \\"update\\": {
                                        \\"node\\": {
                                            \\"id\\": \\"new-id\\"
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Delete Node", async () => {
        const query = gql`
            mutation {
                deleteUsers {
                    nodesDeleted
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            DETACH DELETE this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Delete Node + User Defined Where", async () => {
        const query = gql`
            mutation {
                deleteUsers(where: { name: "Bob" }) {
                    nodesDeleted
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.name = $param0 AND (this.id IS NOT NULL AND this.id = $thisauth_param0))
            DETACH DELETE this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"Bob\\",
                \\"thisauth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Delete Nested Node", async () => {
        const query = gql`
            mutation {
                deleteUsers(delete: { posts: { where: {} } }) {
                    nodesDeleted
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            OPTIONAL MATCH (this)-[this_posts0_relationship:HAS_POST]->(this_posts0:Post)
            WHERE (exists((this_posts0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0auth_param0)))
            WITH this, collect(DISTINCT this_posts0) as this_posts0_to_delete
            FOREACH(x IN this_posts0_to_delete | DETACH DELETE x)
            DETACH DELETE this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_posts0auth_param0\\": \\"id-01\\"
            }"
        `);
    });

    test("Connect Node (from create)", async () => {
        const query = gql`
            mutation {
                createUsers(
                    input: [
                        { id: "123", name: "Bob", password: "password", posts: { connect: { where: { node: {} } } } }
                    ]
                ) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
            CREATE (this0:User)
            SET this0.id = $this0_id
            SET this0.name = $this0_name
            SET this0.password = $this0_password
            WITH this0
            CALL {
            	WITH this0
            	OPTIONAL MATCH (this0_posts_connect0_node:Post)
            	WHERE (exists((this0_posts_connect0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this0_posts_connect0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this0_posts_connect0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this0 IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this0_posts_connect0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this0)-[:HAS_POST]->(this0_posts_connect0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            RETURN this0
            }
            RETURN [
            this0 { .id }] AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"this0_id\\": \\"123\\",
                \\"this0_name\\": \\"Bob\\",
                \\"this0_password\\": \\"password\\",
                \\"this0_posts_connect0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node + User Defined Where (from create)", async () => {
        const query = gql`
            mutation {
                createUsers(
                    input: [
                        {
                            id: "123"
                            name: "Bob"
                            password: "password"
                            posts: { connect: { where: { node: { id: "post-id" } } } }
                        }
                    ]
                ) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "CALL {
            CREATE (this0:User)
            SET this0.id = $this0_id
            SET this0.name = $this0_name
            SET this0.password = $this0_password
            WITH this0
            CALL {
            	WITH this0
            	OPTIONAL MATCH (this0_posts_connect0_node:Post)
            	WHERE this0_posts_connect0_node.id = $this0_posts_connect0_node_param0 AND (exists((this0_posts_connect0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this0_posts_connect0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this0_posts_connect0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this0 IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this0_posts_connect0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this0)-[:HAS_POST]->(this0_posts_connect0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            RETURN this0
            }
            RETURN [
            this0 { .id }] AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"this0_id\\": \\"123\\",
                \\"this0_name\\": \\"Bob\\",
                \\"this0_password\\": \\"password\\",
                \\"this0_posts_connect0_node_param0\\": \\"post-id\\",
                \\"this0_posts_connect0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node (from update update)", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { posts: { connect: { where: { node: {} } } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            	WITH this
            	OPTIONAL MATCH (this_posts0_connect0_node:Post)
            	WHERE (exists((this_posts0_connect0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0_connect0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0_connect0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this_posts0_connect0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this)-[:HAS_POST]->(this_posts0_connect0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_posts0_connect0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node + User Defined Where (from update update)", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { posts: { connect: { where: { node: { id: "new-id" } } } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            	WITH this
            	OPTIONAL MATCH (this_posts0_connect0_node:Post)
            	WHERE this_posts0_connect0_node.id = $this_posts0_connect0_node_param0 AND (exists((this_posts0_connect0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0_connect0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0_connect0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this_posts0_connect0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this)-[:HAS_POST]->(this_posts0_connect0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_posts0_connect0_node_param0\\": \\"new-id\\",
                \\"this_posts0_connect0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node (from update connect)", async () => {
        const query = gql`
            mutation {
                updateUsers(connect: { posts: { where: { node: {} } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            	WITH this
            	OPTIONAL MATCH (this_connect_posts0_node:Post)
            	WHERE (exists((this_connect_posts0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_connect_posts0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_connect_posts0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this_connect_posts0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this)-[:HAS_POST]->(this_connect_posts0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            WITH *
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_connect_posts0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Connect Node + User Defined Where (from update connect)", async () => {
        const query = gql`
            mutation {
                updateUsers(connect: { posts: { where: { node: { id: "some-id" } } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            	WITH this
            	OPTIONAL MATCH (this_connect_posts0_node:Post)
            	WHERE this_connect_posts0_node.id = $this_connect_posts0_node_param0 AND (exists((this_connect_posts0_node)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_connect_posts0_node)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_connect_posts0_nodeauth_param0)))
            	FOREACH(_ IN CASE WHEN this IS NULL THEN [] ELSE [1] END |
            		FOREACH(_ IN CASE WHEN this_connect_posts0_node IS NULL THEN [] ELSE [1] END |
            			MERGE (this)-[:HAS_POST]->(this_connect_posts0_node)
            		)
            	)
            	RETURN count(*) AS _
            }
            WITH *
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_connect_posts0_node_param0\\": \\"some-id\\",
                \\"this_connect_posts0_nodeauth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Disconnect Node (from update update)", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { posts: { disconnect: { where: {} } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            WITH this
            OPTIONAL MATCH (this)-[this_posts0_disconnect0_rel:HAS_POST]->(this_posts0_disconnect0:Post)
            WHERE (exists((this_posts0_disconnect0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0_disconnect0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0_disconnect0auth_param0)))
            FOREACH(_ IN CASE WHEN this_posts0_disconnect0 IS NULL THEN [] ELSE [1] END |
            DELETE this_posts0_disconnect0_rel
            )
            RETURN count(*) AS _
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_posts0_disconnect0auth_param0\\": \\"id-01\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Disconnect Node + User Defined Where (from update update)", async () => {
        const query = gql`
            mutation {
                updateUsers(update: { posts: [{ disconnect: { where: { node: { id: "new-id" } } } }] }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            WITH this
            OPTIONAL MATCH (this)-[this_posts0_disconnect0_rel:HAS_POST]->(this_posts0_disconnect0:Post)
            WHERE this_posts0_disconnect0.id = $updateUsers_args_update_posts0_disconnect0_where_Postparam0 AND (exists((this_posts0_disconnect0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_posts0_disconnect0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_posts0_disconnect0auth_param0)))
            FOREACH(_ IN CASE WHEN this_posts0_disconnect0 IS NULL THEN [] ELSE [1] END |
            DELETE this_posts0_disconnect0_rel
            )
            RETURN count(*) AS _
            }
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"updateUsers_args_update_posts0_disconnect0_where_Postparam0\\": \\"new-id\\",
                \\"this_posts0_disconnect0auth_param0\\": \\"id-01\\",
                \\"updateUsers\\": {
                    \\"args\\": {
                        \\"update\\": {
                            \\"posts\\": [
                                {
                                    \\"disconnect\\": [
                                        {
                                            \\"where\\": {
                                                \\"node\\": {
                                                    \\"id\\": \\"new-id\\"
                                                }
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Disconnect Node (from update disconnect)", async () => {
        const query = gql`
            mutation {
                updateUsers(disconnect: { posts: { where: {} } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            WITH this
            OPTIONAL MATCH (this)-[this_disconnect_posts0_rel:HAS_POST]->(this_disconnect_posts0:Post)
            WHERE (exists((this_disconnect_posts0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_disconnect_posts0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_disconnect_posts0auth_param0)))
            FOREACH(_ IN CASE WHEN this_disconnect_posts0 IS NULL THEN [] ELSE [1] END |
            DELETE this_disconnect_posts0_rel
            )
            RETURN count(*) AS _
            }
            WITH *
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"this_disconnect_posts0auth_param0\\": \\"id-01\\",
                \\"updateUsers\\": {
                    \\"args\\": {
                        \\"disconnect\\": {
                            \\"posts\\": [
                                {
                                    \\"where\\": {}
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("Disconnect Node + User Defined Where (from update disconnect)", async () => {
        const query = gql`
            mutation {
                updateUsers(disconnect: { posts: { where: { node: { id: "some-id" } } } }) {
                    users {
                        id
                    }
                }
            }
        `;

        const req = createJwtRequest("secret", { sub: "id-01", roles: ["admin"] });
        const result = await translateQuery(neoSchema, query, {
            req,
        });

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:\`User\`)
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            WHERE (this.id IS NOT NULL AND this.id = $thisauth_param0)
            WITH this
            CALL {
            WITH this
            OPTIONAL MATCH (this)-[this_disconnect_posts0_rel:HAS_POST]->(this_disconnect_posts0:Post)
            WHERE this_disconnect_posts0.id = $updateUsers_args_disconnect_posts0_where_Postparam0 AND (exists((this_disconnect_posts0)<-[:HAS_POST]-(:\`User\`)) AND all(auth_this0 IN [(this_disconnect_posts0)<-[:HAS_POST]-(auth_this0:\`User\`) | auth_this0] WHERE (auth_this0.id IS NOT NULL AND auth_this0.id = $this_disconnect_posts0auth_param0)))
            FOREACH(_ IN CASE WHEN this_disconnect_posts0 IS NULL THEN [] ELSE [1] END |
            DELETE this_disconnect_posts0_rel
            )
            RETURN count(*) AS _
            }
            WITH *
            RETURN collect(DISTINCT this { .id }) AS data"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"thisauth_param0\\": \\"id-01\\",
                \\"updateUsers_args_disconnect_posts0_where_Postparam0\\": \\"some-id\\",
                \\"this_disconnect_posts0auth_param0\\": \\"id-01\\",
                \\"updateUsers\\": {
                    \\"args\\": {
                        \\"disconnect\\": {
                            \\"posts\\": [
                                {
                                    \\"where\\": {
                                        \\"node\\": {
                                            \\"id\\": \\"some-id\\"
                                        }
                                    }
                                }
                            ]
                        }
                    }
                },
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });
});