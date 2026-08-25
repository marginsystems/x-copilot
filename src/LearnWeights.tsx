import {
  LEARN_SOURCE_SHA,
  LEARN_WEIGHTS,
  formatLearnWeight,
  type LearnWeight,
} from "./lib/learn";

type LearnWeightsProps = {
  selected: LearnWeight;
  onSelect: (row: LearnWeight) => void;
};

export function LearnWeights(props: LearnWeightsProps) {
  return (
    <div className="learn-table-wrap">
      <table>
        <caption>
          Default For You action weights at {LEARN_SOURCE_SHA}. Select a row
          to pin it.
        </caption>
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Default</th>
            <th scope="col">Param</th>
          </tr>
        </thead>
        <tbody>
          {LEARN_WEIGHTS.map((row) => {
            const current = row.param === props.selected.param;
            return (
              <tr
                key={row.param}
                className={current ? "is-selected" : undefined}
                tabIndex={0}
                aria-selected={current}
                onClick={() => props.onSelect(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onSelect(row);
                  }
                }}
              >
                <td>{row.action}</td>
                <td>{formatLearnWeight(row.weight)}</td>
                <td>{row.param}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
