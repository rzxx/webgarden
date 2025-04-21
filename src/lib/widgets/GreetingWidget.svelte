<script context="module" lang="ts">
	import type { WidgetSizeOption } from '../stores';

	export const sizeOptions: WidgetSizeOption[] = [
		{ rows: 1, cols: 2, label: 'Small Horizontal (1x2)' },
        { rows: 1, cols: 3, label: 'Small Wide (1x3)' },
		{ rows: 2, cols: 2, label: 'Medium Square (2x2)' },
		{ rows: 2, cols: 3, label: 'Medium Wide (2x3)' },
        { rows: 1, cols: 4, label: 'Banner (1x4)' },
	];

    // Settings specific to the Greeting Widget
    export const SettingsOptions = [
        {
            setting: 'showSubtitle',
			label: 'Show Subtitle',
			type: 'boolean',
        },
        {
            setting: 'username',
            label: 'Name (Optional)',
            type: 'string',
        },
        {
            setting: 'alignment',
			label: 'Alignment',
			type: 'select',
            options: [
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' }
            ]
        },
    ];

    // Default settings for the Greeting Widget
    export const defaultSettings = {
		showSubtitle: true,
		showName: true,
        username: '',
		alignment: 'left',
	};
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

    // Props
	export let settings: Record<string, any> | undefined = {};

	// --- State ---
	let now = new Date();
	let intervalId: ReturnType<typeof setInterval>;
    let greeting: string = '';
    let subtitle: string = '';

	// --- Reactive Computations ---

	// Merge incoming settings with defaults
	$: mergedSettings = { ...defaultSettings, ...settings };

    // Determine Greeting and Subtitle based on time
    $: {
        const hours = now.getHours();

        let partialGreeting = "Hello"; // Default greeting

        // Define time slots and corresponding messages
        // Note: 22 means 10 PM, 5.5 means 5:30 AM
        if (hours >= 5.5 && hours < 12) { // 5:30 AM to 11:59 AM
            partialGreeting = "Good morning";
            subtitle = "Have a nice day!";
        } else if (hours >= 12 && hours < 18) { // 12:00 PM to 5:59 PM
            partialGreeting = "Good afternoon";
            subtitle = "Hope you're having a productive day!";
        } else if (hours >= 18 && hours < 22) { // 6:00 PM to 9:59 PM
            partialGreeting = "Good evening";
            subtitle = "Time to relax.";
        } else { // 10:00 PM to 5:29 AM
            partialGreeting = "Good night";
            subtitle = "Sleep well.";
        }

        // Append name if setting is enabled and name is available
        if (mergedSettings.username.trim() !== '') {
            if (hours >= 5.5 && hours < 18) greeting = `${partialGreeting}, ${mergedSettings.username.trim()}!`;
            else greeting = `${partialGreeting}, ${mergedSettings.username.trim()}.`;
        } else {
            if (hours >= 5.5 && hours < 18) greeting = `${partialGreeting}!`;
            else greeting = `${partialGreeting}.`;
        }
    }


	// --- Lifecycle ---

	onMount(() => {
		// Update time every minute is enough for greetings, but second keeps it synced with clock
        // Sticking to seconds for consistency with your clock example
		intervalId = setInterval(() => {
			now = new Date();
		}, 1000); // Update every second

        // Initial update
        now = new Date();
	});

	onDestroy(() => {
		// Clear interval on component destroy
		if (intervalId) {
			clearInterval(intervalId);
		}
	});
</script>

<!-- HTML Structure -->
<div class="flex flex-col data-[align=left]:items-start data-[align=center]:items-center data-[align=right]:items-end
bg-white rounded-lg text-black p-4 justify-center
font-outfit" data-align={mergedSettings.alignment}>
    <!-- Apply alignment using CSS variable -->
    <p class="text-2xl font-semibold">{greeting}</p>
    {#if mergedSettings.showSubtitle}
        <p class="text-sm font-light text-brighterblack">{subtitle}</p>
    {/if}
</div>