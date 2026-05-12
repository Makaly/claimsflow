import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'CIC Claims Automation API is running!';
  }
}
