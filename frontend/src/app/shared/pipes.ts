import { Pipe, PipeTransform } from '@angular/core';

/** Valor absoluto: usado en la tabla de morosos para mostrar "23d vencido". */
@Pipe({ name: 'abs', standalone: true, pure: true })
export class AbsPipe implements PipeTransform {
  transform(v: number | null | undefined): number {
    return Math.abs(v ?? 0);
  }
}
