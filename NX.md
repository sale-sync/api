
---

````md
# Nx Integration – Developer Setup Guide

Sale Sync API uses **Nx** as a lightweight orchestration and caching layer **on top of** the existing Makefile + npm workspaces.  
Nx does **not** replace SAM, the Makefile, or your existing folder structure. It simply provides:

- Faster builds via smart caching  
- Dependency graph visualization  
- `affected` commands  
- A cleaner way to run tasks across multiple services  

---

## 1. Install Nx

Run the following in the repo root:

```bash
npm install -D nx

# Initialize Nx (choose "Minimum" when prompted)
npx nx init
````

We use the **Minimum** setup so Nx does not modify our workspace structure or tools.

---

## 2. Project Layout

Nx treats each service as its own project:

```
auth/        → Auth Lambda
workspace/   → Workspace Lambda
crm/         → CRM Lambda
packages/    → Shared library (@sale-sync/shared)
```

Each folder gets a corresponding `project.json` for Nx.

Example final structure:

```
.
├── auth/
│   └── project.json
├── workspace/
│   └── project.json
├── crm/
│   └── project.json
├── packages/
│   └── project.json
├── Makefile
├── nx.json
└── package.json
```

---

## 3. Nx Project Configurations

### 3.1 `auth/project.json`

```jsonc
{
  "name": "auth",
  "root": "auth",
  "sourceRoot": "auth",
  "projectType": "application",
  "targets": {
    "compile": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run compile",
        "cwd": "auth"
      }
    },
    "bundle": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run bundle",
        "cwd": "auth"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm test",
        "cwd": "auth"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run lint",
        "cwd": "auth"
      }
    }
  }
}
```

### 3.2 `workspace/project.json`

```jsonc
{
  "name": "workspace",
  "root": "workspace",
  "sourceRoot": "workspace",
  "projectType": "application",
  "targets": {
    "compile": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run compile",
        "cwd": "workspace"
      }
    },
    "bundle": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run bundle",
        "cwd": "workspace"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm test",
        "cwd": "workspace"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run lint",
        "cwd": "workspace"
      }
    }
  }
}
```

### 3.3 `crm/project.json`

```jsonc
{
  "name": "crm",
  "root": "crm",
  "sourceRoot": "crm",
  "projectType": "application",
  "targets": {
    "compile": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run compile",
        "cwd": "crm"
      }
    },
    "bundle": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run bundle",
        "cwd": "crm"
      }
    },
    "test": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm test",
        "cwd": "crm"
      }
    },
    "lint": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run lint",
        "cwd": "crm"
      }
    }
  }
}
```

### 3.4 `packages/project.json` (Shared Library)

```jsonc
{
  "name": "shared",
  "root": "packages",
  "sourceRoot": "packages/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npm run build",
        "cwd": "packages"
      }
    },
    "shared.pack": {
      "executor": "nx:run-commands",
      "options": {
        "command": "make shared.pack"
      }
    }
  }
}
```

### 3.5 Optional: Root `project.json` for SAM/Makefile

```jsonc
{
  "name": "api-infra",
  "root": ".",
  "projectType": "application",
  "targets": {
    "build": {
      "executor": "nx:run-commands",
      "options": {
        "command": "make build"
      }
    },
    "dev": {
      "executor": "nx:run-commands",
      "options": {
        "command": "make dev"
      }
    },
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "make deploy"
      }
    }
  }
}
```

---

## 4. Nx Configuration (`nx.json`)

```jsonc
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "npmScope": "sale-sync",
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx/tasks-runners/default",
      "options": {
        "cacheableOperations": [
          "build",
          "compile",
          "bundle",
          "test",
          "lint",
          "shared.pack",
          "deploy"
        ]
      }
    }
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"]
    },
    "compile": {
      "dependsOn": ["^compile"]
    }
  }
}
```

---

## 5. Root npm Scripts (Optional)

```jsonc
{
  "scripts": {
    "nx": "nx",
    "build": "nx run-many -t compile --projects=auth,workspace,crm",
    "bundle": "nx run-many -t bundle --projects=auth,workspace,crm",
    "lint": "nx run-many -t lint --projects=auth,workspace,crm",
    "test": "nx run-many -t test --projects=auth,workspace,crm",
    "shared.pack": "nx run shared:shared.pack",
    "clean": "rimraf node_modules auth/node_modules workspace/node_modules crm/node_modules packages/node_modules .aws-sam"
  }
}
```

---

## 6. Day-to-Day Commands

### Build & Bundle All Services

```bash
npx nx run-many -t compile --all
npx nx run-many -t bundle --projects=auth,workspace,crm
```

### Test & Lint

```bash
npx nx run-many -t test --all
npx nx run-many -t lint --all
```

### Shared Library

```bash
npx nx run shared:build
npx nx run shared:shared.pack
```

### Makefile / SAM Actions via Nx

```bash
npx nx run api-infra:build
npx nx run api-infra:dev
npx nx run api-infra:deploy
```

You can still run the original Makefile commands directly:

```bash
make shared.pack
make bundle
make build
make start
make deploy
```

---

## 7. Useful Developer Tools

### Visualize Dependency Graph

```bash
npx nx graph
```

### Only Build What Changed

```bash
npx nx affected -t bundle --base=origin/main --head=HEAD
```

---

## 8. Adding a New Service

When creating a new Lambda service:

1. Create a new folder (e.g., `billing/`)
2. Add a local `package.json` and scripts (`compile`, `bundle`, etc.)
3. Add a `billing/project.json`
4. Add it to npm workspaces in the root

Nx will automatically include it in the graph and caching system.

---

## 9. Summary

* Nx is an **additive tool**, not a replacement for Makefile/SAM.
* It speeds up development through:

  * Caching
  * Affected commands
  * Project graph
  * Simple orchestration of all services

Your existing SAM deployment pipeline stays untouched.

---

```

---

If you'd like, I can also generate:

✅ `README.md` version  
✅ `docs/architecture.md` including Nx graph screenshot  
✅ A developer onboarding guide for new engineers  

Just tell me what format you want.
```
