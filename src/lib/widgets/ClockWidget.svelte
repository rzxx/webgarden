<script lang="ts">
    import { onMount, onDestroy } from 'svelte';

    export let settings: Record<string, any> | undefined = {}; // Receive settings if any

    let currentTime = new Date();
    let intervalId: number;

    onMount(() => {
        intervalId = window.setInterval(() => {
            currentTime = new Date();
        }, 1000); // Update every second
    });

    onDestroy(() => {
        if (intervalId) {
            clearInterval(intervalId);
        }
    });

    // Example of using settings (though this clock doesn't need any yet)
    // const format = settings?.timeFormat || 'HH:mm:ss';

    $: timeString = currentTime.toLocaleTimeString(); // Use locale default format
</script>

<div class="clock-widget">
    <h2>{timeString}</h2>
</div>

<style>
    .clock-widget {
        text-align: center;
        font-family: sans-serif;
        color: #333;
    }
    h2 {
        margin: 0;
        font-size: 1.5em; /* Adjust size as needed */
        font-weight: normal;
    }
</style>