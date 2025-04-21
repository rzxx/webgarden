// Import all available widget components
import ClockDateWidget from './widgets/ClockDateWidget.svelte';
// Import * as allows access to named exports like sizeOptions
import * as ClockDateWidgetModule from './widgets/ClockDateWidget.svelte';

import WeatherWidget from './widgets/WeatherWidget.svelte';
import * as WeatherWidgetModule from './widgets/WeatherWidget.svelte';

/**
 * Maps component name strings to the actual Svelte component *constructor*
 * (the default export). Used for dynamically rendering widgets.
 */
export const widgetComponentMap: Record<string, any> = {
    ClockDateWidget: ClockDateWidget,
    WeatherWidget: WeatherWidget,
    // Add other widgets here
};

/**
 * Maps component name strings to the component's *module*.
 * This allows access to named exports within the module, like `sizeOptions`.
 * Used by the settings modal.
 */
export const widgetComponentModules: Record<string, any> = {
    ClockDateWidget: ClockDateWidgetModule,
    WeatherWidget: WeatherWidgetModule,
    // Add other widgets here
};

// Optional: You could also centralize default settings or other metadata here
export const defaultWidgetSettings: Record<string, Record<string, any>> = {
    ClockDateWidget: {},
    WeatherWidget: {},
}

export const defaultWidgetSize: Record<string, { rows: number, cols: number }> = {
    ClockDateWidget: { rows: 1, cols: 2 }, // Default to the first size option perhaps
    WeatherWidget: { rows: 2, cols: 2 },
}