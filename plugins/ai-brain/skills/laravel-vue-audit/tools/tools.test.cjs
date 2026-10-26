#!/usr/bin/env node
// Run: node tools/tools.test.cjs  — fixture-based smoke tests for the bundled helpers.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const run = (tool, ...args) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, tool), ...args], { encoding: "utf8" }));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lva-fx-"));
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };
  w("composer.json", JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }));
  w("app/Http/Controllers/Controller.php", "<?php\nnamespace App\\Http\\Controllers;\nabstract class Controller {}\n");
  w("app/Traits/Searches.php", "<?php\nnamespace App\\Traits;\ntrait Searches {\n    public function search() {}\n}\n");
  w("app/Http/Controllers/WageTypeController.php", [
    "<?php", "namespace App\\Http\\Controllers;", "/**", " * Example: class Foo extends Bar { use Baz; }", " */",
    "class WageTypeController extends Controller {", "    public function index() { return 'https://example.com/x'; }", "}",
  ].join("\n"));
  w("app/Http/Controllers/ShiftController.php", [
    "<?php", "namespace App\\Http\\Controllers;", "use App\\Traits\\Searches;",
    "class ShiftController extends Controller {", "    use Searches;",
    "    public function index() {}", "    public function store() {}", "    public function update() {}", "    public function destroy() {}", "}",
  ].join("\n"));
  w("routes/web.php", [
    "<?php", "use App\\Http\\Controllers\\WageTypeController;", "use App\\Http\\Controllers\\ShiftController;",
    "Route::get('/wage-types', [WageTypeController::class, 'index']);",
    "Route::get('/wage-types/search', [WageTypeController::class, 'search']); // missing",
    "Route::get('/shifts/search', [ShiftController::class, 'search']); // via trait",
    "Route::resource('shifts', ShiftController::class)->except(['create', 'edit']);",
    "Route::get('/legacy', 'WageTypeController@index');",
  ].join("\n"));
  w("database/migrations/2024_01_01_000000_create_shifts_table.php", [
    "<?php", "return new class extends Migration { public function up(): void {",
    "  Schema::create('shifts', function (Blueprint $table) {", "    $table->id();", "    $table->foreignId('employee_id')->constrained()->cascadeOnDelete();",
    "    $table->String('kind', 20)->nullable();", "    $table->unsignedBigInteger('team_id');", "    $table->timestamps();", "  });",
    "} public function down(): void { Schema::dropIfExists('shifts'); } };",
  ].join("\n"));
  w("database/migrations/2024_02_01_000000_alter_shifts.php", [
    "<?php", "return new class extends Migration { public function up(): void {",
    "  Schema::table('shifts', function (Blueprint $table) {", "    $table->renameColumn('kind', 'shift_kind');", "    $table->index(['team_id', 'created_at']);", "  });",
    "} };",
  ].join("\n"));
  const block = Array.from({ length: 30 }, (_, i) => `    $total${i} = $items->where('status', 'approved')->sum('amount') * 1.081;`).join("\n");
  w("app/Services/A.php", `<?php\nclass A {\n  public function run($items) {\n${block}\n  }\n}\n`);
  w("app/Services/B.php", `<?php\nclass B {\n  public function go($rows) {\n${block}\n  }\n}\n`);
  return root;
}

test("route-integrity finds missing method, honours traits, resources, legacy strings and docblocks", () => {
  const root = fixture();
  const r = run("route-integrity.cjs", root);
  assert.deepStrictEqual(r.missing.map((m) => m.action.split("\\").pop()), ["WageTypeController@search", "ShiftController@show"]);
  assert.strictEqual(r.unresolved.length, 0);
  assert.strictEqual(r.missing[0].line, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test("schema-map replays create/alter, renames, FKs, and case-insensitive types", () => {
  const root = fixture();
  const s = run("schema-map.cjs", root);
  const t = s.tables.shifts;
  assert.deepStrictEqual(Object.keys(t.columns).sort(), ["created_at", "employee_id", "id", "shift_kind", "team_id", "updated_at"]);
  assert.strictEqual(t.columns.shift_kind.nullable, true);
  assert.ok(t.foreign_keys.some((f) => f.column === "employee_id" && f.on === "employees" && f.onDelete === "cascade"));
  assert.ok(t.indexes.some((i) => i.columns.join(",") === "team_id,created_at"));
  assert.ok(!t.indexes.some((i) => i.columns.join(",") === "team_id"), "plain unsignedBigInteger has no index");
  assert.deepStrictEqual(s.warnings, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("column-check finds a missing column in a multi-line chain with closures and inside a transaction closure", () => {
  const root = fixture();
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };
  w("app/Models/Shift.php", "<?php\nnamespace App\\Models;\nclass Shift extends Model {\n  public function getLabelAttribute() { return 'x'; }\n}\n");
  w("app/Services/ShiftService.php", [
    "<?php", "class ShiftService {", "  public function a($ids) {",
    "    return Shift::whereHas('employee', fn ($q) => $q->where('nope_in_closure', 1))",
    "      ->where('team_id', 1)",
    "      ->whereDoesntHave('x', function ($q) { $q->where('also_ignored', 2); })",
    "      ->get(['id', 'shift_kind', 'shift_type', 'label']);",
    "  }",
    "  public function b() {",
    "    DB::transaction(function () {",
    "      $s = Shift::create(['team_id' => 1, 'colour' => 'red']);",
    "      Shift::query()->selectRaw('count(*) as c')->groupBy('team_id')->pluck('c');",
    "    });",
    "  }", "}",
  ].join("\n"));
  const r = run("column-check.cjs", root);
  assert.deepStrictEqual(r.misses.map((m) => `${m.table}.${m.column}@${m.line}`).sort(), ["shifts.colour@11", "shifts.shift_type@7"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("dupe-scan reports the cross-file clone", () => {
  const root = fixture();
  const d = run("dupe-scan.cjs", root, "--min-tokens", "50");
  const files = d.clones.flatMap((c) => c.locations.map((l) => l.file));
  assert.ok(files.includes("app/Services/A.php") && files.includes("app/Services/B.php"), JSON.stringify(d.clones));
  fs.rmSync(root, { recursive: true, force: true });
});
