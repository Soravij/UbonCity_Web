# Runtime schema reference

This is a reference-only snapshot of `SHOW CREATE TABLE` output from Runtime MySQL 8.0.46 on 27 July 2026. Do not run it as a migration.

It is retained because `users`, `categories`, and `places` have no `CREATE TABLE` definition in the backend code or migrations. Known schema drift remains: `category_translations` has the wrong shape, and `users.role` defaults to `'admin'`.

## Fresh-install golden reference

`golden-fresh-install-schema.sql` is **not** the correct target schema. It is retained only as a historical `SHOW CREATE TABLE` snapshot of the old install path: the four-table baseline, backend boot, and lazy schema-creating GET paths. It is not a migration and **must not be used as a comparison criterion**.

That old path omitted the 11 `places` decision/location columns that are supplied only by migrations `004` and `011`. As a result, its schema makes `/api/homepage-layout` fail with HTTP 500. Keep this file only as historical evidence of that failure mode.

The authoritative fresh-install schema is `../000_baseline_schema.sql` itself.
