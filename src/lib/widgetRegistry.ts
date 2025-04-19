// Import all available widget components
import ClockWidget from './widgets/ClockWidget.svelte';
// Import * as allows access to named exports like sizeOptions
import * as ClockWidgetModule from './widgets/ClockWidget.svelte';

// Import other widgets similarly
// import WeatherWidget from './widgets/WeatherWidget.svelte';
// import * as WeatherWidgetModule from './widgets/WeatherWidget.svelte';

/**
 * Maps component name strings to the actual Svelte component *constructor*
 * (the default export). Used for dynamically rendering widgets.
 */
export const widgetComponentMap: Record<string, any> = {
    ClockWidget: ClockWidget,
    // WeatherWidget: WeatherWidget,
    // Add other widgets here
};

/**
 * Maps component name strings to the component's *module*.
 * This allows access to named exports within the module, like `sizeOptions`.
 * Used by the settings modal.
 */
export const widgetComponentModules: Record<string, any> = {
    ClockWidget: ClockWidgetModule,
    // WeatherWidget: WeatherWidgetModule,
    // Add other widgets here
};

// Optional: You could also centralize default settings or other metadata here
export const defaultWidgetSettings: Record<string, Record<string, any>> = {
    ClockWidget: {},
    // WeatherWidget: { unit: 'C' },
}

export const defaultWidgetSize: Record<string, { rows: number, cols: number }> = {
    ClockWidget: { rows: 1, cols: 2 }, // Default to the first size option perhaps
    // WeatherWidget: { rows: 2, cols: 2 },
}