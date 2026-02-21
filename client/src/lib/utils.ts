import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Project request status mapping with widely supported emojis
export const PROJECT_REQUEST_STATUS_MAP: Record<string, { emoji: string; label: string; color: string }> = {
  'pending': { 
    emoji: '⏳', // Hourglass - widely supported
    label: 'Pending', 
    color: 'text-orange-400' 
  },
  'working': { 
    emoji: '⚙️', // Gear - widely supported
    label: 'Working', 
    color: 'text-yellow-400' 
  },
  'done': { 
    emoji: '✅', // Check mark - widely supported
    label: 'Done', 
    color: 'text-green-400' 
  },
  'canceled': { 
    emoji: '❌', // Cross mark - widely supported
    label: 'Canceled', 
    color: 'text-red-400' 
  },
  'suspended': { 
    emoji: '⏸️', // Pause button - widely supported
    label: 'Suspended', 
    color: 'text-red-400' 
  }
};

// Utility function to get status display info
export function getStatusDisplay(status: string) {
  return PROJECT_REQUEST_STATUS_MAP[status] || PROJECT_REQUEST_STATUS_MAP['pending'];
}

// Utility function to format status with emoji
export function formatStatusWithEmoji(status: string): string {
  const statusInfo = getStatusDisplay(status);
  return `${statusInfo.emoji} ${statusInfo.label}`;
}