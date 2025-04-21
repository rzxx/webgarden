<script context="module" lang="ts">
	import type { WidgetSizeOption } from '../stores'; // Adjust path if needed

    // --- Reusable Size Options ---
	export const sizeOptions: WidgetSizeOption[] = [
		{ rows: 1, cols: 1, label: 'Tiny (1x1)' },
		{ rows: 1, cols: 2, label: 'Small Horizontal (1x2)' },
		{ rows: 2, cols: 2, label: 'Medium Square (2x2)' },
		{ rows: 2, cols: 3, label: 'Medium Wide (2x3)' },
		{ rows: 3, cols: 5, label: 'Large Wide (3x5)' } // Example - might need different content/layout for larger sizes
	];

    // --- Weather Specific Settings ---
    export const SettingsOptions = [
        {
            setting: 'locationQuery',
            label: 'Location (City Name)',
            type: 'string',
            placeholder: 'e.g., London, UK',
        },
        {
            setting: 'tempUnit',
            label: 'Temperature Unit',
            type: 'select',
            options: [
                { value: 'celsius', label: 'Celsius (°C)' },
                { value: 'fahrenheit', label: 'Fahrenheit (°F)' }
            ]
        },
        {
            setting: 'windSpeedUnit',
            label: 'Wind Speed Unit',
            type: 'select',
            options: [
                { value: 'kmh', label: 'km/h' },
                { value: 'ms', label: 'm/s' },
                { value: 'mph', label: 'mph' },
                { value: 'kn', label: 'knots' }
            ]
        },
        {
            setting: 'updateIntervalMinutes',
            label: 'Update Frequency',
            type: 'select', // Using select for predefined intervals
            options: [
                { value: 15, label: '15 Minutes' },
                { value: 30, label: '30 Minutes' },
                { value: 60, label: '1 Hour' },
                { value: 180, label: '3 Hours' },
                { value: 360, label: '6 Hours' },
                { value: 720, label: '12 Hours' },
                { value: 1440, label: '24 Hours' },
            ]
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
        {
            setting: 'showPlace',
            label: 'Show Location',
            type: 'boolean',
        }
        // Add more settings as needed (e.g., show feels like, show wind, forecast days etc.)
    ];

    // --- Default Weather Settings ---
    export const defaultSettings = {
		locationQuery: 'London', // Default location query
		tempUnit: 'celsius',
		windSpeedUnit: 'kmh',
        updateIntervalMinutes: 60, // Default update interval: 1 hour
		alignment: 'center',
        showPlace: true,
        // showWind: false,
	};

    // --- Helper: Map WMO Weather Codes to Material Icons and Descriptions ---
    // See Open-Meteo documentation for WMO codes
    function getWeatherInfo(code: number, isDay: number): { description: string; icon: string } {
        const day = isDay === 1;
        switch (code) {
            case 0: return { description: 'Clear sky', icon: day ? 'clear_day' : 'clear_night' }; // Or wb_sunny / nights_stay
            case 1: return { description: 'Mainly clear', icon: day ? 'partly_cloudy_day' : 'partly_cloudy_night' };
            case 2: return { description: 'Partly cloudy', icon: day ? 'partly_cloudy_day' : 'partly_cloudy_night' }; // Or just 'cloud'
            case 3: return { description: 'Overcast', icon: 'cloud' };
            case 45: return { description: 'Fog', icon: 'foggy' };
            case 48: return { description: 'Depositing rime fog', icon: 'foggy' };
            case 51: return { description: 'Light drizzle', icon: 'rainy_light' }; // Or just 'rainy' / 'grain'
            case 53: return { description: 'Moderate drizzle', icon: 'rainy' };
            case 55: return { description: 'Dense drizzle', icon: 'rainy' };
            case 56: return { description: 'Light freezing drizzle', icon: 'ac_unit' }; // Freezing = ac_unit?
            case 57: return { description: 'Dense freezing drizzle', icon: 'ac_unit' };
            case 61: return { description: 'Slight rain', icon: 'rainy_light' };
            case 63: return { description: 'Moderate rain', icon: 'rainy' };
            case 65: return { description: 'Heavy rain', icon: 'rainy_heavy' };
            case 66: return { description: 'Light freezing rain', icon: 'ac_unit' };
            case 67: return { description: 'Heavy freezing rain', icon: 'ac_unit' };
            case 71: return { description: 'Slight snow fall', icon: 'weather_snowy' };
            case 73: return { description: 'Moderate snow fall', icon: 'weather_snowy' };
            case 75: return { description: 'Heavy snow fall', icon: 'weather_snowy' };
            case 77: return { description: 'Snow grains', icon: 'grain' };
            case 80: return { description: 'Slight rain showers', icon: 'rainy_light' };
            case 81: return { description: 'Moderate rain showers', icon: 'rainy' };
            case 82: return { description: 'Violent rain showers', icon: 'rainy_heavy' };
            case 85: return { description: 'Slight snow showers', icon: 'weather_snowy' };
            case 86: return { description: 'Heavy snow showers', icon: 'weather_snowy' };
            case 95: return { description: 'Thunderstorm', icon: 'thunderstorm' }; // Slight or moderate
            case 96: return { description: 'Thunderstorm with hail', icon: 'thunderstorm' }; // Slight hail
            case 99: return { description: 'Thunderstorm with hail', icon: 'thunderstorm' }; // Heavy hail
            default: return { description: 'Unknown', icon: 'question_mark' };
        }
    }

    const CACHE_PREFIX = 'weatherWidgetCache_';

    function getCacheKey(latitude: number | null, longitude: number | null, tempUnit: string, windUnit: string): string | null {
        if (latitude == null || longitude == null) return null;
        // Normalize coords slightly for key stability
        return `${CACHE_PREFIX}${latitude.toFixed(4)}_${longitude.toFixed(4)}_t${tempUnit}_w${windUnit}`;
    }

    function readCache(key: string): { timestamp: number; data: any } | null {
        if (typeof localStorage === 'undefined') return null; // Guard for SSR or unsupported env
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            // Basic validation
            if (typeof parsed === 'object' && parsed !== null && 'timestamp' in parsed && 'data' in parsed) {
                return parsed;
            }
            return null;
        } catch (e) {
            console.error("Error reading from localStorage:", e);
            return null;
        }
    }

    function writeCache(key: string, data: any) {
        if (typeof localStorage === 'undefined') return;
        try {
            const cacheObject = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(key, JSON.stringify(cacheObject));
        } catch (e) {
            console.error("Error writing to localStorage:", e);
            // Optional: Prune old cache items if storage is full
        }
    }
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let settings: Record<string, any> | undefined = {};

	// --- State ---
    let weatherData: any = null; // Store the raw API response
    let isLoading = true;
    let isGeocoding = false;
    let isFetchingWeather = false;
    let error: string | null = null;

    let resolvedLatitude: number | null = null;
    let resolvedLongitude: number | null = null;
    let resolvedLocationName: string | null = null; // e.g., "London, England"

    let currentFetchController: AbortController | null = null;
    let geocodeTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

	// Merge incoming settings with defaults
	$: mergedSettings = { ...defaultSettings, ...settings };

    // Derived Weather Information
    $: displayInfo = weatherData
        ? getWeatherInfo(weatherData.current_weather.weathercode, weatherData.current_weather.is_day)
        : { description: 'Loading...', icon: 'hourglass_empty' };

    $: displayTemp = weatherData
        ? `${Math.round(weatherData.current_weather.temperature)}${mergedSettings.tempUnit === 'celsius' ? '°C' : '°F'}`
        : '--';

    // Combined loading indicator
    $: isLoading = isGeocoding || isFetchingWeather;

    // --- Geocoding Logic ---
	async function geocodeAndFetchWeather(query: string) {
        if (!query?.trim()) {
            error = "Please enter a location.";
            isGeocoding = false;
            isFetchingWeather = false;
            weatherData = null;
            resolvedLatitude = null;
            resolvedLongitude = null;
            resolvedLocationName = null;
            return;
        }

        // Clear previous errors/timeouts
        error = null;
        isGeocoding = true;
        isFetchingWeather = false; // Reset weather fetch state
        weatherData = null; // Clear old weather data

        // Abort previous fetches if any
        currentFetchController?.abort();
        currentFetchController = new AbortController();
        const signal = currentFetchController.signal;

		try {
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
			const response = await fetch(geoUrl, { signal });

            if (signal.aborted) return; // Aborted by subsequent call

            if (!response.ok) {
                throw new Error(`Geocoding error: ${response.statusText}`);
            }
			const geoData = await response.json();

            if (signal.aborted) return;

			if (!geoData.results || geoData.results.length === 0) {
				throw new Error(`Location "${query}" not found.`);
			}

            const result = geoData.results[0];
            resolvedLatitude = result.latitude;
            resolvedLongitude = result.longitude;
            // Construct a display name
            resolvedLocationName = `${result.name}${result.admin1 ? ', ' + result.admin1 : ''}${result.country_code ? ', ' + result.country_code : ''}`;

            isGeocoding = false; // Geocoding successful

            // Now check cache / fetch weather for the resolved coordinates
            checkCacheAndFetchWeather();

		} catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error("Geocoding failed:", err);
                error = err.message || "Failed to find location.";
                resolvedLatitude = null;
                resolvedLongitude = null;
                resolvedLocationName = null;
                isGeocoding = false;
                isFetchingWeather = false;
                weatherData = null;
            }
		}
	}

    // --- Weather Fetching Logic with Cache ---
    async function checkCacheAndFetchWeather() {
        if (resolvedLatitude == null || resolvedLongitude == null) {
            // This shouldn't happen if geocoding was successful, but guard anyway
            error = "Cannot fetch weather without coordinates.";
             isFetchingWeather = false;
            return;
        }

        // Abort ongoing *weather* fetch if any (e.g., from interval)
        // Note: Geocoding might have already aborted this controller, which is fine.
        currentFetchController?.abort();
        currentFetchController = new AbortController(); // New controller for weather fetch
        const signal = currentFetchController.signal;

        const cacheKey = getCacheKey(resolvedLatitude, resolvedLongitude, mergedSettings.tempUnit, mergedSettings.windSpeedUnit);
        const cached = cacheKey ? readCache(cacheKey) : null;
        const intervalMillis = (mergedSettings.updateIntervalMinutes || 60) * 60 * 1000; // Default 1hr

        if (cached && (Date.now() - cached.timestamp < intervalMillis)) {
            console.log("Using cached weather data for:", resolvedLocationName);
            weatherData = cached.data;
            error = null;
            isFetchingWeather = false;
            isGeocoding = false; // Ensure all loading flags are false
            // Schedule the next potential refresh based on cache expiry
            scheduleNextRefresh(cached.timestamp + intervalMillis - Date.now());
            return; // Use cached data
        }

        // --- Proceed to Fetch Fresh Data ---
        console.log("Fetching fresh weather data for:", resolvedLocationName);
        isFetchingWeather = true;
        error = null; // Clear previous errors

        const params = new URLSearchParams({
            latitude: resolvedLatitude.toString(),
            longitude: resolvedLongitude.toString(),
            current_weather: 'true',
            temperature_unit: mergedSettings.tempUnit,
            windspeed_unit: mergedSettings.windSpeedUnit,
            timezone: 'auto'
        });
        const apiUrl = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

        try {
            const response = await fetch(apiUrl, { signal });

            if (signal.aborted) { console.log("Weather fetch aborted"); return; }

            if (!response.ok) {
                let errorBody = `HTTP error ${response.status}`;
                try { errorBody = (await response.json()).reason || errorBody; } catch(e){}
                throw new Error(errorBody);
            }

            const data = await response.json();
            if (signal.aborted) return;

            if (!data?.current_weather?.temperature === undefined) {
                throw new Error('Invalid weather data structure received.');
            }

            weatherData = data;
            // --- Write to Cache ---
            if (cacheKey) {
                writeCache(cacheKey, data);
            }
            // --- End Cache Write ---

        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error("Failed to fetch weather data:", err);
                error = err.message || "Failed to load weather.";
                weatherData = null; // Clear potentially stale data on error
            }
        } finally {
            if (!signal.aborted) {
                isFetchingWeather = false;
                 // Schedule next refresh even if fetch failed (to retry later)
                scheduleNextRefresh(intervalMillis);
            }
        }
    }

    // --- Debounce Geocoding ---
    function debouncedGeocode(query: string, delay: number = 500) {
        clearTimeout(geocodeTimeoutId!);
        // Show loading immediately for better UX while typing stops
        if (query?.trim()) {
            isGeocoding = true; // Set geocoding true early
            isFetchingWeather = false;
            error = null;
            weatherData = null; // Clear old data
        } else {
             isGeocoding = false; // Clear loading if query is empty
             error = "Please enter a location."; // Prompt user
        }

        geocodeTimeoutId = setTimeout(() => {
            geocodeAndFetchWeather(query);
        }, delay);
    }

    // --- Auto-Refresh Logic ---
    function scheduleNextRefresh(delay: number) {
         clearInterval(refreshIntervalId!); // Clear existing interval/timeout

        // Ensure delay is reasonable (e.g., at least 1 min)
        const refreshDelay = Math.max(delay, 60 * 1000);

        console.log(`Scheduling next weather refresh in ${Math.round(refreshDelay / 60000)} minutes.`);

        refreshIntervalId = setTimeout(() => {
            console.log("Performing scheduled weather refresh...");
            // Re-run the check: it will either use cache if still valid somehow, or fetch new
            checkCacheAndFetchWeather();
        }, refreshDelay);
    }

	// --- Lifecycle & Reactivity ---

	/// --- Lifecycle & Reactivity ---
	onMount(() => {
        // Initial fetch based on default/passed settings
        debouncedGeocode(mergedSettings.locationQuery, 0); // Initial fetch, no delay

        // Cleanup interval on destroy
        return () => {
            clearTimeout(geocodeTimeoutId!);
            clearInterval(refreshIntervalId!);
            currentFetchController?.abort(); // Abort any ongoing fetch on destroy
        };
	});

    // React to changes in location query from settings
    $: if (mergedSettings.locationQuery) {
        // Check if it actually changed from the *resolved* one to avoid loops
        // For simplicity, we'll just re-trigger debounce on any change for now.
        // A more robust check would compare against the query that *led* to the current lat/lon.
        console.log("Location query setting changed:", mergedSettings.locationQuery);
        debouncedGeocode(mergedSettings.locationQuery);
    }

    // React to unit changes - re-fetch immediately (will likely hit cache unless interval passed)
    $: if (mergedSettings.tempUnit || mergedSettings.windSpeedUnit) {
        // Need to ensure coordinates are resolved before fetching
        if (resolvedLatitude !== null && resolvedLongitude !== null) {
            // Trigger check/fetch, but don't reset geocoding state
            console.log("Unit setting changed, re-checking weather.");
            checkCacheAndFetchWeather();
        }
    }

     // React to interval changes - reschedule the next refresh
    $: if (mergedSettings.updateIntervalMinutes) {
        console.log("Update interval changed, rescheduling refresh.");
        const cacheKey = getCacheKey(resolvedLatitude, resolvedLongitude, mergedSettings.tempUnit, mergedSettings.windSpeedUnit);
        const cached = cacheKey ? readCache(cacheKey) : null;
        const lastDataTimestamp = cached?.timestamp || Date.now();
        const intervalMillis = (mergedSettings.updateIntervalMinutes || 60) * 60 * 1000;
        const nextRefreshDelay = Math.max(0, (lastDataTimestamp + intervalMillis) - Date.now());
        scheduleNextRefresh(nextRefreshDelay);
    }
</script>

<!-- HTML Structure -->
<div class="data-[aligncenter=true]:flex grid grid-cols-2 items-center justify-center
bg-white rounded-lg text-black p-4
font-outfit" data-aligncenter={mergedSettings.alignment==='center'}>
    {#if error}
        <span class="material-symbols-outlined text-red">error</span>
        <p class="text-sm text-red">{error}</p>
    {:else if isLoading}
        <span class="material-symbols-outlined animate-spin justify-self-center">progress_activity</span>
        {#if isGeocoding}
            <p class="text-sm">Finding Location...</p>
        {:else if isFetchingWeather}
            <p class="text-sm">Loading Weather...</p>
        {/if}
	{:else if weatherData}
        {#if mergedSettings.alignment === "left"}
        <div class="flex flex-col justify-center-safe items-start">
            {#if resolvedLocationName && mergedSettings.showPlace}
                <p class="text-xs text-brightblack">{resolvedLocationName}</p>
            {/if}
            <p class="text-4xl font-semibold">{displayTemp}</p>
        </div>
        <div class="flex flex-col justify-center-safe items-center ml-4">
            <span class="material-symbols-outlined -mt-2" style="font-size: 4rem;" title={displayInfo.description}>
                {displayInfo.icon}
            </span>
            <p class="text-xs -mt-0.5 text-brighterblack">{displayInfo.description}</p>
        </div>
        {:else if mergedSettings.alignment === "center"}
        <div class="flex flex-col items-center">
            {#if resolvedLocationName && mergedSettings.showPlace}
                <p class="text-xs text-brightblack text-center">{resolvedLocationName}</p>
            {/if}
            <span class="material-symbols-outlined" style="font-size: 2rem;" title={displayInfo.description}>
                {displayInfo.icon}
            </span>
            <p class="text-xl font-semibold -mt-1 text-center">{displayTemp}</p>
            <p class="text-xs text-brighterblack text-center">{displayInfo.description}</p>
        </div>
        {:else}
        <div class="flex flex-col justify-center-safe items-center mr-4">
            <span class="material-symbols-outlined -mt-2" style="font-size: 4rem;" title={displayInfo.description}>
                {displayInfo.icon}
            </span>
            <p class="text-xs -mt-0.5 text-brighterblack">{displayInfo.description}</p>
        </div>
        <div class="flex flex-col justify-center-safe items-end">
            {#if resolvedLocationName && mergedSettings.showPlace}
                <p class="text-xs text-brightblack text-right">{resolvedLocationName}</p>
            {/if}
            <p class="text-4xl font-semibold">{displayTemp}</p>
        </div>
        {/if}
	{:else}
         <span class="material-symbols-outlined text-brightblack">cloud_off</span>
		 <p class="text-sm text-brighterblack">No weather data</p>
	{/if}
</div>