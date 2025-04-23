// Define key colors using CSS color strings
const NIGHT_COLOR = '#04080F';   // Deep blue/black
const SUNRISE_COLOR = '#FFD670'; // Warm yellow/orange
const DAY_COLOR = '#B3E2F9';     // Light blue sky (close to Midday)
const SUNSET_COLOR = '#ED6A5A';  // Orangey-red

// Define approximate time ranges (hours 0-23)
const SUNRISE_START_HOUR = 5;
const DAY_START_HOUR = 9; // Broader day range
const SUNSET_START_HOUR = 18;
const NIGHT_START_HOUR = 21; // Earlier night start

/**
 * Calculates a simplified background color based on the time of day.
 * @param currentTime The current Date object.
 * @returns A CSS color string (hex).
 */
export function getBackgroundColorForTime(currentTime: Date): string {
    const currentHour = currentTime.getHours();

    if (currentHour >= NIGHT_START_HOUR || currentHour < SUNRISE_START_HOUR) {
        return NIGHT_COLOR;
    } else if (currentHour >= SUNRISE_START_HOUR && currentHour < DAY_START_HOUR) {
        // Simple transition: return sunrise color during this period
        return SUNRISE_COLOR;
    } else if (currentHour >= DAY_START_HOUR && currentHour < SUNSET_START_HOUR) {
        // Simple transition: return day color during this period
        return DAY_COLOR;
    } else { // currentHour >= SUNSET_START_HOUR && currentHour < NIGHT_START_HOUR
        // Simple transition: return sunset color during this period
        return SUNSET_COLOR;
    }
}