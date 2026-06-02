# DCI Platform — Backend & Database Setup

This is the backend service for the DCI Team Collaboration Platform, built with **NestJS**, **MySQL 8.0**, and **Prisma ORM**.

This guide covers setting up a local database environment using **Docker Compose** and managing it using **Adminer** or **Prisma Studio**, fully compatible with both **macOS** and **Windows**.

---

## Prerequisites

1. **Docker Desktop** installed and running on your machine:
   - [Docker Desktop for macOS](https://docs.docker.com/desktop/install/mac-install/)
   - [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/) (WSL 2 backend recommended).
2. **Node.js** (v18.x or later installed locally; Node v24 is recommended).
   - *Note: If you have version conflicts, run `nvm use 24` to switch to Node 24.*

---

## 1. Quick Start: Spin Up Database & Adminer

The local MySQL database and Adminer (database management client) run inside Docker containers. The database is configured to automatically initialize all 11 tables and constraints on its first run using the `init.sql` file.

Open your terminal (macOS Zsh/Bash, or Windows PowerShell/Git Bash) and run:

```bash
# Navigate to the backend folder (if you aren't already there)
cd backend

# Start the database and Adminer services in the background
docker compose up -d
```

*(Note: On older Docker installations, use `docker-compose up -d` instead).*

---

## 2. Managing the Database with Adminer

Once the containers are running:
1. Open your browser and navigate to: **[http://localhost:8080](http://localhost:8080)**
2. Log in using the following credentials:

| Field | Value | Description |
|---|---|---|
| **System** | `MySQL` (or `MySQL / MariaDB`) | Database Driver |
| **Server** | **`db`** | The Docker database container service name (do NOT use `localhost`) |
| **Username** | `root` | Database admin username |
| **Password** | `rootpassword` | Database admin password |
| **Database** | `dci_platform` | Default schema name |

From Adminer, you can visually browse tables, run SQL queries, insert dummy data, and monitor relations.

---

## 3. Environment Variables Configuration

The NestJS app connects to the database using the `DATABASE_URL` environment variable. A local `.env` file has been created for you with the following connection string:

```env
DATABASE_URL="mysql://root:rootpassword@localhost:3306/dci_platform"
```

*Note: Since the NestJS app runs directly on your host machine, it connects to MySQL via `localhost:3306`, while Adminer connects using the Docker container hostname `db`.*

---

## 4. Prisma Integration & Commands

Prisma is used as the ORM to query the database. The database structure is mapped in `src/prisma/schema.prisma`. 

To generate TypeScript types and interact with Prisma, run the following commands:

### Generate Prisma Client
Generates TypeScript models and typings based on `schema.prisma`. Run this whenever you modify the Prisma schema:
```bash
# Ensure Node 24 is active if you have version conflicts
nvm use 24

# Generate client
npm run prisma:generate
```

### Open Prisma Studio
Starts an interactive database explorer locally at **[http://localhost:5555](http://localhost:5555)**:
```bash
npm run prisma:studio
```

---

## Platform-Specific Troubleshooting

### 1. Port 3306 Already in Use
If Docker fails to start because port `3306` is already occupied, you likely have a native MySQL instance running on your host machine.

*   **On macOS**:
    Stop the native MySQL service using Homebrew:
    ```bash
    brew services stop mysql
    ```
*   **On Windows (PowerShell as Administrator)**:
    Stop the native MySQL Windows service:
    ```powershell
    Stop-Service -Name "mysql"
    # or
    net stop mysql
    ```

### 2. Docker Desktop Connection Issues (Windows)
- Ensure Docker Desktop is started.
- In Docker Desktop Settings, check **General** -> **Use the WSL 2 based engine**. This ensures Docker is integrated correctly with Windows Subsystem for Linux (WSL) for faster file sharing and network resolution.