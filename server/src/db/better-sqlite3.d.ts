/**
 * better-sqlite3 최소 타입 선언
 * npm install better-sqlite3 후에는 @types/better-sqlite3 사용 가능
 */
declare module "better-sqlite3" {
  interface Statement {
    run(...params: any[]): any
    get(...params: any[]): any
    all(...params: any[]): any[]
  }

  interface Transaction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): ReturnType<T>
  }

  interface Database {
    pragma(source: string, options?: any): any
    exec(source: string): this
    prepare(source: string): Statement
    transaction<T extends (...args: any[]) => any>(fn: T): Transaction<T>
    close(): void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: any): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
