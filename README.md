# AMIS Roadmap Extension 🎓

A client-side academic intelligence tool engineered to parse unstructured university curriculum data and dynamically generate optimal graduation roadmaps using graph theory and topological sorting.

## 🚀 Engineering Overview

This system was built to solve a complex data-flow challenge: transforming a static, linear list of curriculum requirements into a dynamic, state-aware decision tree based on real-time academic history. 

By operating entirely within the browser's execution context, the architecture guarantees **zero-latency updates** and **strict data privacy**. No student data, session tokens, or academic records ever leave the local machine.

### Core Technical Pillars
* **Algorithmic Pathfinding:** Utilizes a **Directed Acyclic Graph (DAG)** to map course prerequisites, co-requisites, and equivalent groupings. The logic engine performs **Topological Sorts** to dynamically calculate eligible coursework.
* **Secure State Management:** Implements `chrome.storage.session` to securely scrape and handle volatile API tokens natively, ensuring credentials are never written to persistent disk storage.
* **Client-Side Integration:** Extracts and sanitizes real-time JSON payloads directly from the university's REST API, completely bypassing the need for a middleware server and eliminating external points of failure.

## 🛠 Tech Stack

* **Core Logic Engine:** Vanilla JavaScript (ES6+), Graph Theory (DAGs)
* **Environment:** Chrome Extension API (Manifest V3)
* **Data Integration:** RESTful API polling, DOM Parsing, Asynchronous State Management
* **Styling:** Vanilla CSS, CSS Grid/Flexbox

## ⚙️ Installation (Developer Mode)

1. Clone this repository to your local machine:
   ```bash
   git clone [https://github.com/jjjoyosa/amis-roadmap-extension.git](https://github.com/jjjoyosa/amis-roadmap-extension.git)```

2. Open Google Chrome and navigate to 
    ```bash
    chrome://extensions/.```

3. Enable Developer mode using the toggle in the top right corner.

4. Click Load unpacked and select the directory where you cloned the repository.

5. Log in to the AMIS portal. The extension will automatically sync with your active session and generate your roadmap.