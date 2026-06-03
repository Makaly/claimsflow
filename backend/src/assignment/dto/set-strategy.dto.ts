import { IsIn } from 'class-validator';

export class SetStrategyDto {
  @IsIn(['workload', 'fifo'])
  strategy: 'workload' | 'fifo';
}
