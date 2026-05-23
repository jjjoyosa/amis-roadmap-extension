# Architecture Overview: AMIS Roadmap Extension

## System Philosophy
Operates on a **Client-Side-Only, Zero-Server Architecture**. All computations are performed securely within the browser's execution context.

## Technical Components
- **Core Engine (`src/engine/`):** Utilizes a DAG representation to perform Topological Sorts for prerequisite resolution.
- **Service Layer (`src/services/`):** Handles communication with the AMIS API using `chrome.storage.session`.
