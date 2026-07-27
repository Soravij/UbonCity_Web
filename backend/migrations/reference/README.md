# Runtime schema reference

This is a reference-only snapshot of `SHOW CREATE TABLE` output from Runtime MySQL 8.0.46 on 27 July 2026. Do not run it as a migration.

It is retained because `users`, `categories`, and `places` have no `CREATE TABLE` definition in the backend code or migrations. Known schema drift remains: `category_translations` has the wrong shape, and `users.role` defaults to `'admin'`.
