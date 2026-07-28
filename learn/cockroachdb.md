- distributed sql
- transactional, strongly conssitent kv store
- scales horizontally, survives, disk,machine,rack, data center failure
- strongly consistent acid transactions, sql api
- inspired by google spanner and f1

- replicated across multiple nodes
- add more nodes to cluster for scalability
- acid transactions
- geo partitioning - reduced latency, regulatory compliance, survive outages
- supports postgresql wire protocol and synatax. migration is easy.
  - wire protocol is a message based network communication system, defines how clients like psql and database drivers exchange startups handshakes, auth, queries over tcp port 5432 or unix sockets

- availability model is "multi-active availability", high a, but read and write from every node without generating conflicts - wow that's quite a claim?

- active-passive - active replica, changes to its state are copied to backup passive. if you use async replication, cannot guarantee that any data is succesfully replicated to passive followers
  - if you use sync replication, and passive replicas fail, either sacrifice availability for all or risk inconsistencies (write to both simultaneously, confirm once both are saved, how would this risk inconsistencies? is the cdb doc slightly off?)

- active-active
  - multiplie replicas run identical services
  - route to all of them
  - dificult to instrument, how to handle writes and inconsistencies?

- multi-active availability
  like active-active, all replicas can handle traffic, including reads and writes
- consensus replication - replication requsts are sent to at least 3 replicas, only committed when majority ack
- can have some failures without compromising availability
- clusters that loes majority replicas stop responding

this is CP systems, favours being consistent instead of available when partitions occur

two ways of supporting ai

- enable ai assisted dev
- data store

- mcp - access to cockroachdb clusters and docs
- agent skills repo encodes operational workflows in machine executable format
- vector data, similarity search with strongly consistent transactions, horizontal scalability, and multi region deployments.
- store vector embeddings, agent state, conversation histories, and other ai related data alongside relational data.

- cluster level read and write access via cloud mcp server
- operational workflows - agent skills for cockroach db
- command line automation with ccloud cli
- i should have an operational workflow for cosine actually

- agent skills : small structured capabilities that encode cockroach db operational expertise in machine executable format. there are available in public repo and follow the agent skills specification with defined inputs outputs and safety guardrails.
- ccloud cli
- ai assistant can generate or run ccloud commands to set up clusters, rotate credentials, or retrive connection urls
- vector search and rag, text, images, other content as vector embeddings.
- vector data type, fixed length, floating point embeddings, similariy ops such as l2 distance, inner product, and cosine distance
- implement rag and semantic search patterns.
- ai agent state, need execution state, workflow metadata, and operatoinal history.
- track state transactions across multi-step processes, coordinate concurrent executions, and safe retries
- transactional model - store all this
- serializable isolation - state transitions occur even when multiple agents or processes attempt concurrent updates
