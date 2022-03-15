# Subscriptions

## Problem

Our users would like to use [GraphQL Subscriptions](https://graphql.org/blog/subscriptions-in-graphql-and-relay/) to get real-time updates on their data.

## Requirements

### Must have

- To subscribe to the following events:
  - CREATE
  - UPDATE
  - DELETE
- Ability to filter which nodes are subscribed to (i.e. `where` clause) - at least by unique property
- Ability to horizontally scale - either now, or able to do so without breaking in the future
- Wherever possible, events are ordered
- Events are fired individually
- We won't mutate our users' databases - no metadata
- All events are sent (for example, if node created and then deleted, we get both events)
- Database transactions must be successful - no optimisticness  
- Garbage collection of old subscriptions
- We return "full objects" including nested relationships (for example, a movie subscription must return type `Movie` with nested `actors`)
- Auth (on read)

### Should have

- To subscribe to the following events:
  - CONNECT
  - DISCONNECT
- Ability to filter which nodes are subscribed to (i.e. `where` clause) - full filtering feature set

### Could have

- Relationship property updates
- Subscriptions to Interface and Union types
- OGM support

### Won't have (this time)

- Events from changes outside of GraphQL (e.g. via Bolt)
- Events triggered from custom Cypher (won't do this ever)

## Proposed Solutions

All solutions will use the following example type definitions:

```graphql
type Movie {
  title: String!
}
```

The subscription type generated by this proposed solution would look like:

```graphql
type MovieCreatedEvent {
  movie: Movie!
}

type MovieUpdatedEvent {
  movie: Movie!
}

type MovieDeletedEvent {
  movie: Movie!
}

type Subscription {
  movieCreated(where: MovieWhere): MovieCreatedEvent!
  movieUpdated(connectAndDisconnect: Boolean! = true, where: MovieWhere): MovieUpdatedEvent!
  movieDeleted(where: MovieWhere): MovieDeletedEvent!
}
```

`connect` and `disconnect` operations will be banded under the `update` operation, and can be included or excluded using an argument.

### Usage Examples

#### Subscribing to creation

If a user wanted to subscribe to all movies being created, they could run the following subscription:

```graphql
subscription {
  movieCreated {
    movie {
      title
    }
  }
}
```

Whenever a create operation is executed, metadata regarding the operation will be generated and returned:

```cypher
CALL {
    CREATE (this0:Movie)
    SET this0.title = "title"
    WITH this0, [{ event: "create", id: id(this0), oldProps: null, newProps: this0 { .* }, timestamp: timestamp() }] as this0meta
    RETURN this0, this0meta
}
RETURN { data: this0 { .title }, meta: this0meta } AS this0
```

#### Subscribing to update

If a user wants to get the updates of a particular movie, they could use a `where` argument:

```graphql
subscription {
  movieUpdated(where: { title: "Titanic" }) {
    movie {
      title
    }
  }
}
```

Whenever a create operation is executed, metadata regarding the operation will be generated and returned:

```cypher
MATCH (this:Movie)
WHERE this.title = "title"
WITH this, this { .* } as oldProps
SET this.title = "title"
RETURN this, { event: "create", id: id(this), newProps: this { .* }, oldProps: oldProps, timestamp: timestamp() } as meta
```

Having the old properties and the new properties to hand means we can actually check whether anything changed as part of the update operation.

#### Subscribing to delete

If a user wants to get the deletion of a particular movie, they could use a `where` argument:

```graphql
subscription {
  movieUpdated(where: { title: "Titanic" }) {
    movie {
      title
    }
  }
}
```

Whenever a create operation is executed, metadata regarding the operation will be generated and returned:

```cypher
MATCH (this:Movie)
WHERE this.title = "title"
WITH this, { event: "delete", id: id(this), oldProps: this { .* }, newProps: null, timestamp: timestamp() } as meta
DETACH DELETE this
RETURN meta
```

### Implementation

Subscriptions will be made available via a plugin, for which we will initially provide a "local" implementation of,
which will not scale horizontally. Providing a plugin API means that later down the line, a plugin can be built which emits
metadata regarding Mutation operations, to be consumed by other instances in a load balanced group.

The plugin will use an `EventEmitter` which is consumed from within each instance. Whenever metadata is returned from a Mutation,
it should be passed to the `publish` function which will handle it appropriately for the implementation.

This plugin definition will look roughly like:

```ts
class Neo4jGraphQLSubscriptionsPlugin {
  public events: EventEmitter;

  constructor() {
    this.events = new EventEmitter();
  }

  abstract public publish(eventMeta: SubscriptionsEvent);
}
```

The "local" implementation of this will look something like:

```ts
class Neo4jGraphQLSubscriptionsLocalPlugin extends Neo4jGraphQLSubscriptionsPlugin {
  public publish(eventMeta: SubscriptionsEvent) {
    this.events.emit(eventMeta);
  }
}
```

And in rough pseudocode, an implementation of this using an AMQP broker would look roughly like:

```ts
class Neo4jGraphQLSubscriptionsAMQPPlugin extends Neo4jGraphQLSubscriptionsPlugin {
  private amqpConnection;

  public publish(eventMeta: SubscriptionsEvent) {
    amqpConnection.publish(eventMeta);
  }

  constructor(brokerUrl, username, password) {
    this.amqpConnection = new AMQPConnection(brokerUrl, username, password);
    this.subscribe();
  }

  private async subscribe() {
    amqpConnection.on("message", (message) => {
      this.events.emit(message);
    })
  }
}
```

The resolvers for a create Mutation and Subscription will look something like:

```ts
const resolvers = {
  Mutation: {
    createMovies: async (context) => {
      const cypher = generateCypher();

      const result = await session.run(cypher);

      context.plugins.subscription.publish(result.meta)

      return result.data;
    }
  },
  Subscription: {
    movieCreated: {
      subscribe: async function *subscribe(where, context) {
        const event = await context.plugins.subscription..events.on("event", () => {
          // Filter the event using the `where` argument
          // This will likely not work in a callback, but somehow yield the events matched
          yield event;
        });
      }
    }
  }
};
```

## Technical Considerations

- Timestamps as part of event payloads?
- Single or multiple entities per event payload? (single preferred at present)
- Do we allow for filtering on properties of related nodes?
- Do we allow for filtering on relationship properties?
- Do we allow for projecting relationships in the selection set?

## Risks

- Maintaining order of events being fired
- Ensure consistency of events data with data in the database
- Make sure it works across popular PubSub Engine implementations (for example <https://www.apollographql.com/docs/apollo-server/data/subscriptions/#production-pubsub-libraries>)
- Make sure it works with `@auth` directive - users shouldn't be able to listen to events for types they can't access
- Efficiency of Cypher queries - do we fetch all properties of a node and allow GraphQL runtime to filter down, or only the properties in the selection set?

## Out of Scope

- Subscription events for relationship connection and disconnection
- Horizontal scaling (in the first implementation)

## Discarded solutions

### Solution 1: Subscription field per node type

The subscription type generated by this proposed solution would look like:

```graphql
enum Event {
  CREATE
  UPDATE
  DELETE
}

type MovieEvent {
  event: Event!
  movie: Movie!
}

type Subscription {
  subscribeToMovies(events: [Event!], where: MovieWhere): MovieEvent!
}
```

### Usage Examples

If a user wanted to subscribe to all movies being created, they could run the following subscription:

```graphql
subscription {
  subscribeToMovies(events: [CREATE]) {
    movie {
      title
    }
  }
}
```

If a user wants to get the updates of a particular movie, they could use a `where` argument:

```graphql
subscription {
  subscribeToMovies(events: [UPDATE], where: { title: "Titanic" }) {
    movie {
      title
    }
  }
}
```

For subscribing to multiple events, it would be sensible to query also for the `event` field which could then be used for filtering which event triggered the notification:

```graphql
subscription {
  subscribeToMovies(events: [CREATE, UPDATE]) {
    event
    movie {
      title
    }
  }
}
```

If the `event` argument is not provided, it will be assumed that all events want to be listened for:

```graphql
subscription {
  subscribeToMovies {
    event
    movie {
      title
    }
  }
}
```