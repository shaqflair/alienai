

from trading_ig import IGService

ig = IGService("Norbee", "Shaq2935", "881e755f7428bbffae2c42b592527fcf163432c7", "DEMO")
ig.create_session()

searches = [
    "Navitas Semiconductor",
    "Lightwave Logic",
    "CoreWeave",
    "Virgin Galactic",
    "AST SpaceMobile",
    "BigBear",
    "Super Micro",
    "Red Cat",
    "United States Natural Gas",
    "United States Oil",
]

for s in searches:
    print("--- " + s + " ---")
    try:
        results = ig.search_markets(s)
        markets = results if isinstance(results, list) else results.get("markets", [])
        for r in markets[:3]:
            print("  " + str(r.get("epic","")) + "  " + str(r.get("instrumentName","")))
        if not markets:
            print("  No results")
    except Exception as e:
        print("  Error: " + str(e))