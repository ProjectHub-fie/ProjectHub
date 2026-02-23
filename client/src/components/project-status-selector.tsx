
import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface ProjectStatusSelectorProps {
  currentStatus: string;
  onStatusChange: (newStatus: string) => void;
  disabled?: boolean;
}

const statusOptions = [
  { value: 'pending', label: 'Pending', variant: 'secondary' },
  { value: 'in_review', label: 'In Review', variant: 'default' },
  { value: 'approved', label: 'Approved', variant: 'default' },
  { value: 'rejected', label: 'Rejected', variant: 'destructive' },
  { value: 'completed', label: 'Completed', variant: 'default' },
];

export function ProjectStatusSelector({ 
  currentStatus, 
  onStatusChange, 
  disabled = false 
}: ProjectStatusSelectorProps) {
  const currentOption = statusOptions.find(option => option.value === currentStatus);
  
  return (
    <div className="flex items-center gap-2">
      <Badge 
        variant={currentOption?.variant as any || 'secondary'}
        className="hidden sm:inline-flex"
      >
        {currentOption?.label || currentStatus}
      </Badge>
      <Select 
        value={currentStatus} 
        onValueChange={onStatusChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-[140px] sm:w-[160px]">
          <SelectValue placeholder="Select status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center gap-2">
                <Badge variant={option.variant as any} className="text-xs">
                  {option.label}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}