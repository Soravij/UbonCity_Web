# UbonCity Project Commands

## Paths

- Dev path: `cd D:\UbonCity_Web`
- Runtime path: `cd D:\UbonRuntime\repos\UbonCity_Web`

## Git

```text
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch-name>

git branch --show-current
git status -sb
git diff --name-only
git diff --check
git log --oneline --decorate -5

git add <files>
git commit -m "<message>"
git push -u origin <branch-name>
```

## Sync

```text
git fetch origin
git switch <branch-name>
git pull --ff-only origin <branch-name>

git fetch origin
git switch <branch-name>
git reset --hard origin/<branch-name>
```

## Runtime Stack

```text
.\ops\windows\test-stack.ps1 stop -RuntimeRoot "D:\UbonRuntime\repos\UbonCity_Web"
.\ops\windows\test-stack.ps1 start -RuntimeRoot "D:\UbonRuntime\repos\UbonCity_Web"
.\ops\windows\test-stack.ps1 status -RuntimeRoot "D:\UbonRuntime\repos\UbonCity_Web"
```

## Health Checks

```text
curl.exe -I "https://api-test.uboncity.com/api/health"
curl.exe -s "https://api-test.uboncity.com/api/places/<category>/<slug>?lang=th"
curl.exe -I "<image_url>"
```
