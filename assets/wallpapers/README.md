# Offline wallpapers

Prism bundles 50 offline wallpapers. Star Trails at La Hague (W003), by Antoine Lamielle, is the default.

Each image is distributed under its own listed artwork license, independently of Prism’s MIT code. The normalized 3840×2160 JPEG masters in `images/` use 16:9 crops, no enlargement, sRGB conversion and JPEG 4:4:4 quality 96. App builds preserve these source files and encode separate 1920×1080 and 3840×2160 runtime JPEGs directly from them using MozJPEG, 4:4:4 sampling, and quality 90. `encoding.json` records the default and any per-image quality overrides. Thumbnails (640×360) and frost images (960×540) are shared. No new crop is applied to these masters. Glass Chip uses the recorded source rectangle `(0,512,4096,2304)`; the resulting JPEG uses the same display path as every wallpaper. These adaptations retain each image’s original artwork license. Runtime manifests record each derivative’s dimensions, quality, SHA256 and the source-master hash. Packaging rejects stale variants when a master changes. Only one full-size resolution is included in each widget; normal browser preview uses 1080p.

Original URLs, SHA256 values, dimensions, exact licensing evidence and supplied copyright notices are retained in [sources.json](sources.json). The same attribution and changes are included in the app credits and packaged `wallpapers/CREDITS.md` / `SOURCES.json`. Additional license texts and supplied package notices are in [licenses/](licenses/). No creator, desktop or distribution endorsement is implied.

Normal builds are offline and require only the checked-in JPEG masters. To explicitly reconstruct a master from its pinned/hashed upstream source, use `python3 scripts/fetch-wallpapers.py --cache /absolute/external/cache --only W247` after installing npm dependencies. JPEG XL originals additionally require `djxl`; Ubuntu package sources require `dpkg-deb`. Those tools are not required for normal builds. The explicit regeneration command verifies both original and generated hashes before replacing an approved master.

| Selection | Wallpaper | Credit | Artwork license |
|---|---|---|---|
| W247 | Glass Chip | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W003 | Star Trails at La Hague | Antoine Lamielle | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W016 | G5 Aurora | W.carter | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W025 | Wrocław at Dusk | Jar.ciurus | CC BY-SA 3.0 pl · https://creativecommons.org/licenses/by-sa/3.0/pl/deed.en |
| W028 | Nyhavn Sunset | Moahim | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W041 | Above the Clouds · Ai-Petri | Dmytro Balkhovitin | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W042 | Kjeungskjær Lighthouse | Gordon Leggett; Photo:  Gordon Leggett  /  Wikimedia Commons | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W085 | Spullersee | Feel free to use my photos, but please mention me as the author and if you want send me a message . or ( rufre@lenz-nenning.at ) | CC BY-SA 3.0 at · https://creativecommons.org/licenses/by-sa/3.0/at/deed.en |
| W088 | Dawn on Lake Cuniã | RodrigoErse | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W097 | Phraya Nakhon Cave | BerryJ | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W116 | Angelus Hut in Winter | Michal Klajban | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W127 | Christiansborg at Blue Hour | Moahim | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W153 | Hungarian Parliament | Pierre Blaché | CC0 · http://creativecommons.org/publicdomain/zero/1.0/deed.en |
| W165 | Brakelund Winter | Nicklas Sjölund Larsson | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W169 | Toronto Skyline | Martin St-Amant ( S23678 ) | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0 |
| W170 | Lower Manhattan | Superbass | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W172 | Cologne at Sunset | Superbass | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W176 | Albi at Dusk | PierreSelim | CC BY 4.0 · https://creativecommons.org/licenses/by/4.0 |
| W182 | Baikal Ice at Sunset | Sergey Pesterev; ©  Sergey Pesterev  /  Wikimedia Commons | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W199 | Road to Elbrus | Ted.ns | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W214 | Li Phi Falls at Dusk | Basile Morin | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0 |
| W220 | Altai | Alesya Khoteeva | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W221 | Coast | Krystian Zajdel | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W224 | Ice Cold | Santiago Cézar | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W229 | Nuvole | Krystian Zajdel | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W230 | Orionids | Krystian Zajdel | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W232 | Safe Landing | Louis Durrant | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W233 | Scarlet Tree | axo1otl | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W234 | Shell | Lucas Andrade | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W235 | Sub-Arctic | Krystian Zajdel | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W236 | Volna | Nikita Babin | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W237 | Waterfall | Krystian Zajdel | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W238 | Amber | David Lapshin | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W240 | Blendpills | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W241 | Blobs | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W242 | Curvaturingster | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W243 | Curvy | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W245 | Drool | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W246 | Fold | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W248 | Glass Stripes | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W253 | Sheet | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W256 | Tubes | Jakub Steiner | CC BY-SA 3.0 · https://creativecommons.org/licenses/by-sa/3.0/ |
| W257 | Odin · Iceland Coast | Brendon Porter, Ryan Gorley, et al. | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W259 | Sunset by the Pier | Paul Carmona | CC0 1.0 · https://creativecommons.org/publicdomain/zero/1.0/ |
| W262 | Monument Valley | OrbiteLambda | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W263 | South of France | OrbiteLambda | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W264 | Rainbow Lightbulb | Daniel Micallef | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W266 | Autumn | mendhak | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W269 | Fedora 33 · Night | Fedora Design Team | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |
| W270 | Fedora 34 · Night | Fedora Design Team | CC BY-SA 4.0 · https://creativecommons.org/licenses/by-sa/4.0/ |

## Supplied copyright notices

### Glass Chip (W247)

© 2024 Jakub Steiner

### G5 Aurora (W016)

CC BY-SA 4.0

### Wrocław at Dusk (W025)

Jaroslaw Ciurus

### Kjeungskjær Lighthouse (W042)

Â©Gordon.Leggett.2016

### Spullersee (W085)

Boehringer Friedrich [Fred]                           

### Dawn on Lake Cuniã (W088)

RodrigoERSE (69)9984-3960 PVH-RO BRASIL

### Hungarian Parliament (W153)

Pierre Blache

### Lower Manhattan (W170)

CC-BY-SA 4.0

### Albi at Dusk (W176)

CC-BY

### Baikal Ice at Sunset (W182)

Â© Sergey Pesterev 2016

### Li Phi Falls at Dusk (W214)

Basile Morin

### Amber (W238)

© 2023 David Lapshin

### Blendpills (W240)

© 2026 Jakub Steiner

### Blobs (W241)

© 2022 Jakub Steiner

### Curvaturingster (W242)

© 2026 Jakub Steiner. Licensed under CC BY-SA 3.0

### Curvy (W243)

© 2025 Jakub Steiner

### Drool (W245)

© 2021 Jakub Steiner

### Fold (W246)

© 2024 Jakub Steiner

### Glass Stripes (W248)

© 2026 Jakub Steiner

### Sheet (W253)

© 2024 Jakub Steiner

### Tubes (W256)

© 2026 Jakub Steiner

### Monument Valley (W262)

Aaron J Prisk; Abubakar NK; Alexey Kulik; Arman Esmaeili; Artem Kavalerov; Daniel Micallef; Elena Stravoravdi; Gixo; Gustavo Brenner; Hajime Mizuno; Hiking93; João Amaral; Joe Thompson; Joseph Bylund; Joshua T; Joshua Thompson; Juliette Taka; Julian Tomasini; Kacper Ślusarczyk; Keanu Kerr; Mads; Manuel Arslanyan; Marcel Kächele; Mattias Andersson; Michele Agostini; Midge Mantissa Sinnaeve; Mo Taymour; Nicolas Silva; Oklopfer; Oliver Ortiz Sánchez; OrbiteLambda; Paulo José Oliveira Amaro; Rakesh Yadav; Roy Tanck; Sbutcher; Simos Xenitellis; Tibor Mokánszki; Uday Nakade; Víctor Fernández Rico; Zoe T

### South of France (W263)

Aaron J Prisk; Abubakar NK; Alexey Kulik; Arman Esmaeili; Artem Kavalerov; Daniel Micallef; Elena Stravoravdi; Gixo; Gustavo Brenner; Hajime Mizuno; Hiking93; João Amaral; Joe Thompson; Joseph Bylund; Joshua T; Joshua Thompson; Juliette Taka; Julian Tomasini; Kacper Ślusarczyk; Keanu Kerr; Mads; Manuel Arslanyan; Marcel Kächele; Mattias Andersson; Michele Agostini; Midge Mantissa Sinnaeve; Mo Taymour; Nicolas Silva; Oklopfer; Oliver Ortiz Sánchez; OrbiteLambda; Paulo José Oliveira Amaro; Rakesh Yadav; Roy Tanck; Sbutcher; Simos Xenitellis; Tibor Mokánszki; Uday Nakade; Víctor Fernández Rico; Zoe T

### Rainbow Lightbulb (W264)

Aaron J Prisk; Abubakar NK; Alexey Kulik; Arman Esmaeili; Artem Kavalerov; Daniel Micallef; Elena Stravoravdi; Gixo; Gustavo Brenner; Hajime Mizuno; Hiking93; João Amaral; Joe Thompson; Joseph Bylund; Joshua T; Joshua Thompson; Juliette Taka; Julian Tomasini; Kacper Ślusarczyk; Keanu Kerr; Mads; Manuel Arslanyan; Marcel Kächele; Mattias Andersson; Michele Agostini; Midge Mantissa Sinnaeve; Mo Taymour; Nicolas Silva; Oklopfer; Oliver Ortiz Sánchez; OrbiteLambda; Paulo José Oliveira Amaro; Rakesh Yadav; Roy Tanck; Sbutcher; Simos Xenitellis; Tibor Mokánszki; Uday Nakade; Víctor Fernández Rico; Zoe T

### Autumn (W266)

Aaron J Prisk; Abubakar NK; Alexey Kulik; Arman Esmaeili; Artem Kavalerov; Daniel Micallef; Elena Stravoravdi; Gixo; Gustavo Brenner; Hajime Mizuno; Hiking93; João Amaral; Joe Thompson; Joseph Bylund; Joshua T; Joshua Thompson; Juliette Taka; Julian Tomasini; Kacper Ślusarczyk; Keanu Kerr; Mads; Manuel Arslanyan; Marcel Kächele; Mattias Andersson; Michele Agostini; Midge Mantissa Sinnaeve; Mo Taymour; Nicolas Silva; Oklopfer; Oliver Ortiz Sánchez; OrbiteLambda; Paulo José Oliveira Amaro; Rakesh Yadav; Roy Tanck; Sbutcher; Simos Xenitellis; Tibor Mokánszki; Uday Nakade; Víctor Fernández Rico; Zoe T


Asset generation and packaging share a local build lock to prevent concurrent output changes. If a process is interrupted, verify that no Prism build remains active before removing `.local/build.lock`. Original-master reconstruction can fail its strict byte-hash check after an encoder upgrade; preserve the approved masters and review encoder versions instead of overwriting a hash.
