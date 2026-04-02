import React from 'react';
import { FaSpinner } from 'react-icons/fa';

const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12'
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <FaSpinner 
        className={`${sizeClasses[size]} animate-spin text-primary-600 dark:text-primary-400`} 
      />
    </div>
  );
};

export default LoadingSpinner;
