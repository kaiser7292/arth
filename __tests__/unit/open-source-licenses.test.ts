/**
 * Keeps assets/data/open-source-licenses.json in step with package.json.
 * If this fails after adding a dependency, run: npm run licenses
 */
import pkg from "../../package.json";
import licenses from "../../assets/data/open-source-licenses.json";

describe("open-source licences", () => {
  const names = new Set((licenses.packages as Array<{ name: string }>).map((p) => p.name));

  it("lists every direct dependency", () => {
    const missing = Object.keys(pkg.dependencies ?? {}).filter((d) => !names.has(d));
    expect(missing).toEqual([]);
  });

  it("gives every entry a licence type", () => {
    const bad = (licenses.packages as Array<{ name: string; license: string }>).filter((p) => !p.license);
    expect(bad).toEqual([]);
  });
});
