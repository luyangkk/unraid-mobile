# Unraid website theme adaptation

The requested source is now https://unraid.net/, superseding the earlier WebGUI palette mapping. The website has `onDark`, `onBright`, and `onColor` sections rather than a user-selectable dark/light theme. Mapping these sections to this application's appearance preferences is a mobile adaptation.

## Source evidence

Observed 2026-10-25, website build `a3092966-547f-4c09-b480-f53e45c711b7`:

https://cdn.craft.cloud/481d40bf-939a-4dc1-918d-b4d4b48b7c04/builds/a3092966-547f-4c09-b480-f53e45c711b7/artifacts/dist/main-2hqxuWge.css

- Website OKLab palette converted to browser-rendered sRGB: black `#171717`, white `#FFFFFF`, cream `#F1ECE3`, white-rock `#EEE4D2`, tuatara `#2B2A29`, fuscous-gray `#555554`, red `#E22828`, orange `#FF8C2F`, orange-dark `#F15A2C`.
- `onDark` uses black, `onBright` uses cream, `onColor` uses a red-to-orange gradient.
- `.btn-gradient` uses a static red-to-orange fill. Hover/focus switches to `linear-gradient(90deg, red, orange, red, orange)`, `background-size: 300% 100%`, and `gradient 4s linear infinite`.
- The `gradient` keyframes move `background-position` from `100% 100%` to `0% 100%`. `.btn-pill-*` uses masked gradient borders and a 300ms opacity transition.
- Real Buy Now hover was inspected in Chrome and confirmed the animation duration, repetition, and background sizing.
- User Chrome also opened authenticated `http://10.0.0.66/Main`. Current White CSS uses `#F2F2F2` pages, `#E22828` / `#FF8C2F` gradient button borders, 4px corners, and white text on hover gradient fill. Read only; no host actions.

## Application mapping

Dark: page `#171717`, card/Sheet `#2B2A29`, white text. Light: page cream `#F1ECE3`, white card/Sheet, white-rock inner surfaces `#EEE4D2`, black text. Dark inner surface `#333231` is a mobile role. Light brand text uses the website's orange-dark `#F15A2C`.

The user's subsequent correction removes numeric contrast gates in favor of website fidelity. This supersedes the earlier WebGUI and first draft's contrast-derived substitutions. Keep the prior documents as historical records; current rules and tests have no WCAG ratio requirement.

Primary buttons match `.btn-gradient`: 4px corners, uppercase labels, static red/orange fill, white resting text, black hover/focus text. Secondary controls match `.btn-pill-*`: transparent surface, persistent 2px gradient border, pill corners, hover fill fading in over 300ms with the 4s flow. Preserve icon-button size. Header brand identity and selected Tab marker use static website gradients; selected labels retain `aria-current`.

Animate only enabled controls on fine-pointer hover. Keyboard focus shows a static gradient and a separate visible focus ring. Touch interaction and reduced-motion use static gradients. Disabled controls remain neutral and do not animate. No JavaScript animation or new dependencies.

Theme preference storage, first-paint bootstrap, browser theme-color, and static manifest must agree on the new backgrounds. Preserve routes, session, Query cache, SSE, Sheet focus/gestures, and PWA caching/update behavior. No business capability or icon changes.

## Acceptance

Run existing appearance/lifecycle tests, website palette/variant fidelity tests, full frontend suite, and production/PWA build. Verify actual Chrome hover progression, keyboard focus, disabled and touch/reduced-motion behavior, all four pages, authentication, offline shell, and Portals. Record real-device limitations and unavailable Docker checks. No new deployment requested.
