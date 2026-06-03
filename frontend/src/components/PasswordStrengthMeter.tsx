import React from 'react';
import zxcvbn from 'zxcvbn';

interface Props {
  password: string;
}

export const PasswordStrengthMeter: React.FC<Props> = ({ password }) => {
  const result = zxcvbn(password);
  const score = result.score; // 0 to 4

  const createPassLabel = () => {
    switch (score) {
      case 0: return 'Very Weak';
      case 1: return 'Weak';
      case 2: return 'Fair';
      case 3: return 'Good';
      case 4: return 'Strong';
      default: return '';
    }
  };

  const getProgressColor = () => {
    switch (score) {
      case 0: return 'bg-red-500';
      case 1: return 'bg-orange-500';
      case 2: return 'bg-yellow-500';
      case 3: return 'bg-green-400';
      case 4: return 'bg-green-600';
      default: return 'bg-gray-200';
    }
  };

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-500 font-medium">Password Strength</span>
        <span className="text-xs font-semibold" style={{ color: getProgressColor().replace('bg-', '') }}>
          {password ? createPassLabel() : ''}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5 flex overflow-hidden">
        {[...Array(4)].map((_, index) => (
          <div
            key={index}
            className={`h-full transition-all duration-300 ${
              password && index < score ? getProgressColor() : 'bg-transparent'
            } ${index < 3 ? 'border-r border-white' : ''}`}
            style={{ width: '25%' }}
          ></div>
        ))}
      </div>
      {password && result.feedback.warning && (
        <p className="text-xs text-orange-500 mt-1">{result.feedback.warning}</p>
      )}
    </div>
  );
};
