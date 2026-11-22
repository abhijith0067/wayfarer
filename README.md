# Wayfarer: explore where you've just landed

A travel-companion prototype. It takes your location (GPS or a typed place) and shows weather, nearby sights, cheaper cafés, transport, local history and facts, and events/nightlife. No build step, no API keys.

**Run it:** double-click `start.bat` (needs Python), or run `python -m http.server 8793` and open http://localhost:8793.
Deep links: `?q=Hampi` or `?lat=9.9658&lon=76.2421`.

## 1. Version 1 scope
1. **Where am I?** GPS or search, reverse-geocoded to neighbourhood, city and region language.
2. **Weather now and 3-day forecast**, plus travel tips (heat, rain, UV).
3. **Sights**, ranked by notability (whether they have a Wikipedia entry) and distance.
4. **Cafés**, with independents first, a "likely budget" heuristic, and review links in English and the local language.
5. **Getting around:** metro, train, ferry/water metro, bus, auto/taxi stands, bike rental, plus ride-hailing links.
6. **About this place:** a city summary, Wikidata facts, a **local-language summary (Malayalam in Kerala)**, and geotagged "stories around you".
7. **Events:** nightlife and culture/workshop venues, plus event-search links. Live dated events only with an optional Ticketmaster key.

Later versions: saved places, offline city packs, real ratings and prices, dated events, live transit, an itinerary builder, and an LLM "what should I do in the next 3 hours" planner.

## 2. Platform: a PWA first
| Option | Pros | Cons |
|---|---|---|
| **PWA (chosen)** | One codebase. Installable on Android and iOS home screens. GPS works. Offline app shell. Instant to iterate on. | iOS limits push and background location. No home-screen widget. |
| Native (Kotlin/Swift) | Background location, widgets, best maps | Two codebases and app-store releases |
| React Native / Flutter | One codebase, native feel | Build tooling, store releases, overkill before the idea is proven |

Move to a native wrapper (Capacitor) only if background "you've arrived" alerts or widgets become important.

## 3. Data sources
| Category | Source | Cost | Coverage | Terms / notes |
|---|---|---|---|---|
| Geocoding | **Nominatim** (OSM) ✅ | Free | Global | Max 1 req/s, no heavy use, attribution. Self-host or use a paid host (LocationIQ, Geoapify) at scale. |
| POIs (sights, cafés, transport, venues) | **Overpass API** (OSM) ✅ | Free | Global, very good in Europe, patchy in rural areas | Public servers are **often overloaded**. During testing every mirror returned 502/504. Self-host at scale. ODbL attribution. |
| POI fallback | **Photon** (komoot) ✅ | Free | Global OSM | Fair use. Returns fewer tags (no hours or brand). |
| Weather | **Open-Meteo** ✅ | Free for non-commercial use; commercial from about €29/mo | Global | CC BY 4.0, no key |
| Facts/history | **Wikipedia REST + Wikidata** ✅ | Free | Global, with local-language wikis (ml, ta, hi…) | CC BY-SA text (attribute), Wikidata CC0. Send a User-Agent when calling from a server. |
| Ratings, reviews, price level | Google Places API (New) | Pay-as-you-go. Place Details with reviews costs roughly US$20–25 per 1,000 calls, minus monthly free credit | Best global coverage. Reviews can be requested by language (incl. Malayalam). | Strict rules: no caching beyond place IDs, must show on or with Google Maps, attribution. **Paid, so not used.** |
| | Foursquare Places API | Free tier, then paid per call. Tips and photos are premium. | Strong in cities, weaker in small Indian towns | Attribution required |
| Transit | GTFS feeds via **Transitland** / Mobility Database | Free (Transitland has a free key tier) | Good in EU/US. India: Kochi Metro and Water Metro, Delhi, Bengaluru BMTC have GTFS. | Each feed has its own licence. Realtime is rare in India. |
| Events | **Ticketmaster Discovery** | Free key, 5,000 calls/day | US, EU, AU. Almost none in India. | Supported in the app as an optional key |
| | Eventbrite | Public event *search* API removed (2019/20) | — | Only lists your own organisation's events, so the app links out instead |
| | Meetup | GraphQL API needs a Meetup Pro subscription | Global tech/community events | Paid. Link-out for now. |
| | PredictHQ, AllEvents, BookMyShow/District | Paid or partner-only | AllEvents and District are strong in India | Partner deals needed |

## 4. Stack
- **Now:** a static PWA (vanilla JS, Leaflet and OSM tiles), calling free APIs directly from the browser. Zero cost, zero backend.
- **Next:** a small backend (FastAPI or Cloudflare Workers) to:
  - hide API keys (Google/Foursquare/Meetup)
  - cache Overpass/Wikipedia responses per location tile
  - merge and dedupe sources
  - respect rate limits
  - optionally host an LLM summariser ("history in 60 seconds", review translation and summary).
  
  Frontend: keep vanilla JS or move to Svelte/React once the UI grows.

## 5. Real vs placeholder in this prototype
| Section | Status |
|---|---|
| Location (GPS and search) | ✅ Real: browser geolocation and Nominatim |
| Weather and tips | ✅ Real: Open-Meteo |
| Sights | ✅ Real: OSM (Overpass, falling back to Photon) |
| Cafés list | ✅ Real: OSM |
| Café "budget" label | ⚠️ Heuristic (independent, tea/bakery, or local cuisine). OSM has no prices. |
| Café reviews | ⚠️ Links only: Google Maps, plus a Google search in the local language. No ratings shown. |
| Transport stops and stations | ✅ Real: OSM. ⚠️ No timetables, fares or live arrivals. |
| History and facts | ✅ Real: Wikipedia, Wikidata, and the local-language Wikipedia (Malayalam tested on Kochi) |
| Event venues (nightlife, arts, theatres, coworking) | ✅ Real: OSM |
| Dated events (workshops, parties) | ⚠️ Link-outs (AllEvents, Meetup, Eventbrite, BookMyShow, District). Live only with a free Ticketmaster key, mostly useful outside India. |

Tested on Fort Kochi (2026-11-22): every section filled with real data. Overpass was down, so the Photon fallback served the place lists.

## 6. Going further
1. **Reviews and prices:** Google Places (paid) or Foursquare. Needs the backend to hold keys. *Ask before signing up.*
2. **Dated events in India:** an AllEvents or District partnership. Or scrape-free options: city tourism RSS/iCal feeds, college/venue calendars, Instagram via official APIs. Meetup Pro for workshops.
3. **Transit:** load GTFS for target cities (Kochi Metro and Water Metro first) and show next departures.
4. **Reliability:** cache by geohash tile, self-host Overpass/Nominatim or use a paid OSM host, add retry/backoff.
5. **Local language:** translate and summarise Malayalam reviews with an LLM. Show local names everywhere (`name:ml`).
6. **Offline city packs** for patchy roaming data.
