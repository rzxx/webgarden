<script context="module" lang="ts">
	// Assuming WidgetSizeOption is defined elsewhere, e.g., in '../stores'
	// If not, you might define it here or import it properly.
	// Example definition:
	// export interface WidgetSizeOption {
	//  rows: number;
	//  cols: number;
	//  label: string;
	// }
	import type { WidgetSizeOption } from '../stores'; // Adjust path if needed

	export const sizeOptions: WidgetSizeOption[] = [
		{ rows: 1, cols: 1, label: 'Tiny (1x1)' },
		{ rows: 1, cols: 2, label: 'Small Horizontal (1x2)' },
		{ rows: 2, cols: 2, label: 'Medium Square (2x2)' },
		{ rows: 2, cols: 3, label: 'Medium Wide (2x3)' },
        { rows: 5, cols: 3, label: 'Large Tall (5x3)' },
		{ rows: 3, cols: 5, label: 'Large Wide (3x5)' }
	];

    export const SettingsOptions = [
        {
            setting: 'show',
            options: [
                { value: 'both', label: 'Date & Time' },
                { value: 'clock', label: 'Time Only' },
                { value: 'date', label: 'Date Only' }
            ]
        },
        {
            setting: 'order',
            options: [
                { value: 'dateFirst', label: 'Date First' },
                { value: 'clockFirst', label: 'Time First' }
            ]
        },
        {
            setting: 'dateFormat',
            options: [
                { value: 'DD/MM/YYYY', label: '31/12/2023' },
                { value: 'MM/DD/YYYY', label: '12/31/2023' },
                { value: 'YYYY-MM-DD', label: '2023-12-31' },
                { value: 'ShortDate', label: 'Short (12/31/23)' },
                { value: 'MediumDate', label: 'Medium (Dec 31, 2023)' },
                { value: 'LongDate', label: 'Long (December 31, 2023)' },
                { value: 'FullDate', label: 'Full (Sunday, December 31, 2023)' },
                { value: 'WeekdayDDMMYYYY', label: 'Weekday, DD/MM/YYYY' },
                { value: 'WeekdayDDMMMMYYYY', label: 'Weekday, DD Month YYYY' }
            ]
        },
        {
            setting: 'clockFormat',
            options: [
                { value: '12h', label: '12h (11:59 PM)' },
                { value: '12h_seconds', label: '12h with seconds (11:59:01 PM)' },
                { value: '24h', label: '24h (23:59)' },
                { value: '24h_seconds', label: '24h with seconds (23:59:01)' }
            ]
        },
        {
            setting: 'alignment',
            options: [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' }
            ]
        },
        {
            setting: 'theme',
            options: [
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'transparent-light', label: 'Transparent Light Text' },
                { value: 'transparent-dark', label: 'Transparent Dark Text' }
            ]
        },
        {
            setting: 'opacity',
            options: [
                { value: 1.0, label: '100%' },
                { value: 0.9, label: '90%' },
                { value: 0.8, label: '80%' },
                { value: 0.7, label: '70%' },
                { value: 0.6, label: '60%' },
                { value: 0.5, label: '50%' },
                { value: 0.4, label: '40%' },
                { value: 0.3, label: '30%' },
                { value: 0.2, label: '20%' },
                { value: 0.1, label: '10%' }
            ]
        }
    ];

    export const defaultSettings = {
		show: 'both',
		order: 'clockFirst',
		dateFormat: 'WeekdayDDMMMMYYYY',
		clockFormat: '24h',
		alignment: 'center',
		theme: 'dark',
		opacity: 1.0
	};
    
    const themes = {
        light: { background: '#fff', foreground: '#222' },
        dark: { background: '#222', foreground: '#fff' },
        'transparent-light': { background: 'rgba(255,255,255,0.0)', foreground: '#fff' },
        'transparent-dark': { background: 'rgba(0,0,0,0.0)', foreground: '#222' }
    };
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let settings: Record<string, any> | undefined = {};

	// --- State ---
	let now = new Date();
	let intervalId: ReturnType<typeof setInterval>;

	// --- Reactive Computations ---

	// Merge incoming settings with defaults
	$: mergedSettings = { ...defaultSettings, ...settings };

    // Always pick a valid theme, fallback to 'dark'
	$: selectedTheme = themes[mergedSettings.theme as keyof typeof themes] ?? themes.dark;

	// Format Date based on settings
	$: formattedDate = (() => {
		const options: Intl.DateTimeFormatOptions = {};
		const year = now.getFullYear();
		const month = (now.getMonth() + 1).toString().padStart(2, '0');
		const day = now.getDate().toString().padStart(2, '0');
        const weekday = now.toLocaleDateString(undefined, { weekday: 'long'});
        const monthLong = now.toLocaleDateString(undefined, { month: 'long'});

		switch (mergedSettings.dateFormat) {
			case 'DD/MM/YYYY':
				return `${day}/${month}/${year}`;
			case 'MM/DD/YYYY':
				return `${month}/${day}/${year}`;
			case 'YYYY-MM-DD':
				return `${year}-${month}-${day}`;
			case 'ShortDate':
				options.year = '2-digit';
				options.month = 'numeric';
				options.day = 'numeric';
				break;
			case 'MediumDate':
				options.year = 'numeric';
				options.month = 'short';
				options.day = 'numeric';
				break;
			case 'LongDate':
				options.year = 'numeric';
				options.month = 'long';
				options.day = 'numeric';
				break;
			case 'FullDate':
				options.weekday = 'long';
				options.year = 'numeric';
				options.month = 'long';
				options.day = 'numeric';
				break;
            case 'WeekdayDDMMYYYY':
                return `${weekday}, ${day}/${month}/${year}`;
            case 'WeekdayDDMMMMYYYY':
                return `${weekday}, ${day} ${monthLong} ${year}`;
			default: // Fallback to a sensible default if format is unknown
				return `${day}/${month}/${year}`;
		}
        // Use Intl for locale-aware formatting for relevant cases
        if (Object.keys(options).length > 0) {
		    return new Intl.DateTimeFormat(undefined, options).format(now);
        }
        // Should not be reached if all cases are handled, but added for safety
        return `${day}/${month}/${year}`;
	})();

	// Format Time based on settings
	$: formattedTime = (() => {
		const options: Intl.DateTimeFormatOptions = {
			hour: 'numeric',
			minute: '2-digit'
		};
		switch (mergedSettings.clockFormat) {
			case '12h':
				options.hour12 = true;
				break;
			case '12h_seconds':
				options.hour12 = true;
				options.second = '2-digit';
				break;
			case '24h':
				options.hour12 = false;
                options.hourCycle = 'h23'; // Use 00-23 instead of 24
				break;
			case '24h_seconds':
				options.hour12 = false;
                options.hourCycle = 'h23'; // Use 00-23 instead of 24
				options.second = '2-digit';
				break;
            default: // Fallback
                options.hour12 = false;
                options.hourCycle = 'h23';
                break;
		}
		return new Intl.DateTimeFormat(undefined, options).format(now);
	})();

    // Determine CSS styles based on settings
    $: widgetStyles = `
        background-color: ${selectedTheme.background};
        color: ${selectedTheme.foreground};
        opacity: ${mergedSettings.opacity};
        text-align: ${mergedSettings.alignment};
    `;

	// --- Lifecycle ---

	onMount(() => {
		// Update time every second
		intervalId = setInterval(() => {
			now = new Date();
		}, 1000);

        // Initial update in case interval doesn't fire immediately
        now = new Date();
	});

	onDestroy(() => {
		// Clear interval on component destroy to prevent memory leaks
		if (intervalId) {
			clearInterval(intervalId);
		}
	});
</script>

<!-- HTML Structure -->
<div class="widget-container" style={widgetStyles}>
	{#if mergedSettings.show === 'both'}
		{#if mergedSettings.order === 'clockFirst'}
			<span class="widget-time">{formattedTime}</span>
			<span class="widget-date">{formattedDate}</span>
		{:else}
			<span class="widget-date">{formattedDate}</span>
			<span class="widget-time">{formattedTime}</span>
		{/if}
	{:else if mergedSettings.show === 'clock'}
		<span class="widget-time">{formattedTime}</span>
	{:else if mergedSettings.show === 'date'}
		<span class="widget-date">{formattedDate}</span>
	{/if}
</div>

<!-- Styling -->
<style>
	.widget-container {
		display: flex;
        /* Adjust flex direction based on how you want clock/date stacked or side-by-side */
        /* Example: Stack vertically */
		flex-direction: column;
        /* Example: Side-by-side (might need media queries for small sizes) */
        /* flex-direction: row; */
        /* gap: 0.5em; */

		justify-content: center; /* Vertical centering if flex-direction is column */
		width: 100%;
		height: 100%;
		padding: 0.5em; /* Add some padding */
		box-sizing: border-box; /* Include padding in width/height */
		overflow: hidden; /* Prevent content overflow */
		white-space: nowrap; /* Prevent text wrapping, might need adjustment based on size/content */
        line-height: 1.2; /* Adjust line height */
        font-family: sans-serif; /* Basic font */
        /* text-align is handled by inline style */
	}

    /* Optional: Style for individual parts if needed */
    .widget-time, .widget-date {
        display: block; /* Make them stack if flex-direction is column */
    }

    /* Add a small gap between date and time if both are shown and stacked */
    .widget-time + .widget-date,
    .widget-date + .widget-time {
         /* margin-top: 0.2em; */ /* Adjust spacing as needed if stacked */
    }

	/* If using flex-direction: row, you might want space between */
	/*
    .widget-container[style*="flex-direction: row"] .widget-time + .widget-date,
    .widget-container[style*="flex-direction: row"] .widget-date + .widget-time {
        margin-left: 0.5em;
    }
    */

    /* Consider adding font size adjustments based on widget size, perhaps via props or CSS variables */

</style>