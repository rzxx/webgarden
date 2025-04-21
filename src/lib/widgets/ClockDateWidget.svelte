<script context="module" lang="ts">
	import type { WidgetSizeOption } from '../stores'; // Adjust path if needed

	export const sizeOptions: WidgetSizeOption[] = [
		{ rows: 1, cols: 1, label: 'Tiny (1x1)' },
		{ rows: 1, cols: 2, label: 'Small Horizontal (1x2)' },
		{ rows: 2, cols: 2, label: 'Medium Square (2x2)' },
		{ rows: 2, cols: 3, label: 'Medium Wide (2x3)' },
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
				{ value: 'clockFirst', label: 'Time First' },
                { value: 'dateFirst', label: 'Date First' }
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
    ];

    export const defaultSettings = {
		show: 'both',
		order: 'clockFirst',
		dateFormat: 'WeekdayDDMMMMYYYY',
		clockFormat: '24h',
		alignment: 'center',
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
				return `${day}.${month}.${year}`;
			case 'MM/DD/YYYY':
				return `${month}.${day}.${year}`;
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
                return `${weekday}, ${day}.${month}.${year}`;
            case 'WeekdayDDMMMMYYYY':
                return `${weekday}, ${day} ${monthLong} ${year}`;
			default: // Fallback to a sensible default if format is unknown
				return `${day}.${month}.${year}`;
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
<div class="flex flex-col data-[align=left]:items-start data-[align=center]:items-center data-[align=right]:items-end
bg-white rounded-lg text-black p-4 justify-center
font-outfit" data-align={mergedSettings.alignment}>
	{#if mergedSettings.show === 'both'}
		{#if mergedSettings.order === 'clockFirst'}
			<p class="text-2xl font-semibold">{formattedTime}</p>
			<p class="">{formattedDate}</p>
		{:else}
			<p class="text-2xl font-semibold">{formattedDate}</p>
			<p class="">{formattedTime}</p>
		{/if}
	{:else if mergedSettings.show === 'clock'}
		<p class="text-4xl font-semibold">{formattedTime}</p>
	{:else if mergedSettings.show === 'date'}
		<p class="text-3xl font-semibold">{formattedDate}</p>
	{/if}
</div>