import { Injectable } from '@angular/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
  private readonly MAX_FILE_SIZE = 1024 * 1024; // 1MB
  private readonly MAX_FILES = 3;
  private readonly LOG_DIR = 'logs';
  private readonly LOG_FILE_PREFIX = 'app_log_';

  // En producción solo ERROR y WARN, en desarrollo todos
  private minLevel: LogLevel = LogLevel.DEBUG; // Cambiar a WARN en producción

  private buffer: string[] = [];
  private flushTimeout: any = null;

  constructor() {
    this.initLogDir();
  }

  private async initLogDir() {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await Filesystem.mkdir({
        path: this.LOG_DIR,
        directory: Directory.Data,
        recursive: true
      });
    } catch (e) {
      // Directorio ya existe, ignorar
    }
  }

  debug(source: string, message: string) {
    this.log(LogLevel.DEBUG, source, message);
  }

  info(source: string, message: string) {
    this.log(LogLevel.INFO, source, message);
  }

  warn(source: string, message: string) {
    this.log(LogLevel.WARN, source, message);
  }

  error(source: string, message: string, error?: any) {
    const fullMessage = error ? `${message} | ${this.formatError(error)}` : message;
    this.log(LogLevel.ERROR, source, fullMessage);
  }

  private formatError(error: any): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private log(level: LogLevel, source: string, message: string) {
    if (level < this.minLevel) return;

    const entry = this.formatEntry(level, source, message);

    // Siempre mostrar en consola
    this.logToConsole(level, entry);

    // En nativo, guardar a archivo
    if (Capacitor.isNativePlatform()) {
      this.bufferWrite(entry);
    }
  }

  private formatEntry(level: LogLevel, source: string, message: string): string {
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
    const levelStr = LogLevel[level].padEnd(5);
    return `${timestamp} [${levelStr}] ${source}: ${message}`;
  }

  private logToConsole(level: LogLevel, entry: string) {
    switch (level) {
      case LogLevel.DEBUG: console.debug(entry); break;
      case LogLevel.INFO: console.info(entry); break;
      case LogLevel.WARN: console.warn(entry); break;
      case LogLevel.ERROR: console.error(entry); break;
    }
  }

  private bufferWrite(entry: string) {
    this.buffer.push(entry);

    // Flush después de 1 segundo de inactividad o si hay 10+ entradas
    if (this.buffer.length >= 10) {
      this.flush();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), 1000);
    }
  }

  private async flush() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    if (this.buffer.length === 0) return;

    const entries = this.buffer.join('\n') + '\n';
    this.buffer = [];

    try {
      await this.writeToFile(entries);
    } catch (e) {
      console.error('LoggerService: Error writing to file', e);
    }
  }

  private getCurrentLogFile(): string {
    const date = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    return `${this.LOG_DIR}/${this.LOG_FILE_PREFIX}${date}.log`;
  }

  private async writeToFile(content: string) {
    const path = this.getCurrentLogFile();

    try {
      // Intentar append
      await Filesystem.appendFile({
        path,
        data: content,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });
    } catch {
      // Si falla, crear archivo nuevo
      await Filesystem.writeFile({
        path,
        data: content,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });
    }

    // Verificar rotación
    await this.checkRotation();
  }

  private async checkRotation() {
    try {
      const result = await Filesystem.readdir({
        path: this.LOG_DIR,
        directory: Directory.Data
      });

      const logFiles = result.files
        .filter(f => f.name.startsWith(this.LOG_FILE_PREFIX))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Eliminar archivos más viejos si hay más de MAX_FILES
      while (logFiles.length > this.MAX_FILES) {
        const oldest = logFiles.shift();
        if (oldest) {
          await Filesystem.deleteFile({
            path: `${this.LOG_DIR}/${oldest.name}`,
            directory: Directory.Data
          });
        }
      }
    } catch (e) {
      // Ignorar errores de rotación
    }
  }

  /** Obtiene todos los logs para mostrar en la app */
  async getLogs(): Promise<string> {
    if (!Capacitor.isNativePlatform()) {
      return 'Logs solo disponibles en dispositivo nativo';
    }

    // Flush buffer primero
    await this.flush();

    try {
      const result = await Filesystem.readdir({
        path: this.LOG_DIR,
        directory: Directory.Data
      });

      const logFiles = result.files
        .filter(f => f.name.startsWith(this.LOG_FILE_PREFIX))
        .sort((a, b) => b.name.localeCompare(a.name)); // Más reciente primero

      let allLogs = '';
      for (const file of logFiles) {
        const content = await Filesystem.readFile({
          path: `${this.LOG_DIR}/${file.name}`,
          directory: Directory.Data,
          encoding: Encoding.UTF8
        });
        allLogs += `\n=== ${file.name} ===\n`;
        allLogs += content.data as string;
      }

      return allLogs || 'No hay logs disponibles';
    } catch (e) {
      return `Error leyendo logs: ${e}`;
    }
  }

  /** Limpia todos los logs */
  async clearLogs(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const result = await Filesystem.readdir({
        path: this.LOG_DIR,
        directory: Directory.Data
      });

      for (const file of result.files) {
        if (file.name.startsWith(this.LOG_FILE_PREFIX)) {
          await Filesystem.deleteFile({
            path: `${this.LOG_DIR}/${file.name}`,
            directory: Directory.Data
          });
        }
      }
    } catch (e) {
      console.error('LoggerService: Error clearing logs', e);
    }
  }

  /** Exporta los logs como texto para compartir */
  async exportLogs(): Promise<string> {
    return this.getLogs();
  }
}
