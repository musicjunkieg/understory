# Design System Specification: The Illuminated Specimen

## 1. Overview & Creative North Star
**Creative North Star: The Living Archive**
This design system moves away from the sterile, flat world of modern SaaS and retreats into the deep, tactile atmosphere of a primeval understory. We are not building a "dashboard"; we are crafting a digital lens for a field researcher observing bioluminescent life in a misty forest. 

To achieve a "High-End Editorial" feel, we reject rigid, symmetrical grids. Instead, we embrace **intentional asymmetry**, **tonal depth**, and **overlapping layers**. Elements should feel as though they are floating within a dense atmosphere—some sharp and clear, others receding into the fog. 

---

## 2. Colors & Atmospheric Tones
The palette is rooted in the "Smoky Bioluminescent" aesthetic, utilizing high-contrast accents against a deep, verdant-charcoal foundation.

### The Foundation
*   **Surface / Background (`#101411`):** The deep forest floor. This is your canvas. It is never truly "black," but a mossy, charcoal green.
*   **Primary (`#6cfcb2`):** The bioluminescent mint. Use this for high-priority actions and "life" markers.
*   **Tertiary (`#ffdf90`):** The earth-toned amber. This represents the scientific "field note" energy—warm, organic, and authoritative.

### The "No-Line" Rule
**Borders are strictly prohibited for sectioning.** 
You must define boundaries through background color shifts. A `surface-container-low` card sitting on a `surface` background provides all the separation needed. If a container feels "lost," do not add a stroke; increase the elevation tier or apply a subtle `backdrop-filter: blur()`.

### The Glass & Gradient Rule
To simulate "mist," utilize large-scale radial gradients of `surface_tint` at 5%–10% opacity in the background. For floating elements, use a "Misty Glass" approach:
*   **Background:** `surface_variant` at 40% opacity.
*   **Blur:** `backdrop-filter: blur(12px)`.
*   **Signature Glow:** For primary CTAs, apply a soft outer glow using the `primary` color (15% opacity, 20px blur).

---

## 3. Typography
Our typography is a dialogue between the organic (`Newsreader`) and the technical (`Work Sans` and `Space Grotesk`).

*   **Display & Headlines (Newsreader):** Use these for storytelling. The irregular, "rooted" serif feel should dominate the page to provide an editorial, prestigious character. Use `display-lg` (3.5rem) with tighter tracking to create a "specimen" header look.
*   **Body (Work Sans):** Clean and legible. This acts as the "connective tissue" of the system.
*   **Labels (Space Grotesk):** These are your technical field notes. Use `label-md` for metadata, timestamps, or coordinates. It should feel like data harvested by a scientific instrument.

---

## 4. Elevation & Depth: Tonal Layering
Depth is not created by light hitting a surface, but by objects emerging from the fog.

### The Layering Principle
Stack your surfaces to create a hierarchy of importance:
1.  **Deepest:** `surface_container_lowest` (Background elements).
2.  **Base:** `surface` (The main page flow).
3.  **Elevated:** `surface_container_high` (Interactive modules/cards).
4.  **Floating:** `surface_container_highest` (Modals/Popovers).

### Ambient Shadows
Traditional shadows are too "digital." If a shadow is required for a floating element:
*   **Color:** Use a tinted version of the background, not black.
*   **Value:** `0px 20px 40px rgba(0, 0, 0, 0.4)`. It must be extra-diffused to mimic ambient forest light.

### The "Ghost Border" Fallback
If accessibility requirements demand a container edge, use the **Ghost Border**:
*   `outline_variant` at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** Filled with `primary_fixed` (`#6cfcb2`). Text in `on_primary`. Apply an 8px (`DEFAULT`) corner radius. On hover, the button should "glow"—increasing the brightness of the mint rather than changing the color.
*   **Secondary:** No fill. A Ghost Border using `outline` at 20%.
*   **Tertiary:** Text-only in `tertiary_fixed_dim`, utilizing `Space Grotesk` for a technical feel.

### Cards & Modules
*   **Rule:** **Never use divider lines.** 
*   **Structure:** Separate content sections with vertical whitespace (32px–48px) or a shift from `surface_container_low` to `surface_container_lowest`.
*   **Roundness:** Use `lg` (1rem) for card containers to maintain the "organic" feel.

### Input Fields
*   **Background:** `surface_container_highest`. 
*   **State:** On focus, the container should not show a heavy border, but a subtle `primary` outer glow and a slight lightening of the background color. 
*   **Label:** Always use `label-md` in `Space Grotesk` above the field, never inside.

### Chips & Tags
*   Small, rounded capsules (`full` radius). 
*   Background: `secondary_container`. 
*   Text: `on_secondary_container`. Use for "Biological Markers" or "Scientific Categories."

---

## 6. Do's and Don'ts

### Do
*   **Embrace Asymmetry:** Offset your text columns. Let a headline hang over the edge of a container.
*   **Use Overlays:** Allow "fog" (soft gradients) to occasionally overlap the corners of content modules.
*   **Prioritize Scale:** Use the `display-lg` Newsreader font at massive scales to create a signature, "high-fashion" layout.

### Don't
*   **Don't use 1px solid lines.** They break the "smoky" illusion and feel cheap/templated.
*   **Don't use pure white (#FFFFFF) for body text.** Use `on_surface_variant` (`#bbcabe`) to keep the text feeling integrated into the misty atmosphere.
*   **Don't use hard corners.** Avoid `none` or `sm` roundness unless it's for a very specific technical readout. The world is organic; edges are soft.
*   **Don't use standard drop shadows.** If it looks like a "Material Design" shadow, it’s too harsh for this system. Think "ambient occlusion."

---

## 7. Signature Specimen Component (The "Lume-Card")
For featured content, create a "Lume-Card":
*   **Background:** `surface_container_low` at 60% opacity.
*   **Backdrop Blur:** 20px.
*   **Accent:** A 2px top-edge-only "glow" using `primary_fixed_dim`.
*   **Typography:** Newsreader Headline (`headline-md`) overlapping a `Space Grotesk` label (`label-sm`).